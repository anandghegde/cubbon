import { Database } from 'bun:sqlite';
import type { Claim, DocDate, SourceType } from '../model/types.ts';
import type { TriageState } from '../triage/heuristics.ts';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE sources (
    path TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    mtime_ms REAL NOT NULL,
    size INTEGER NOT NULL,
    triage TEXT NOT NULL DEFAULT 'unsure',
    triage_reason TEXT,
    source_type TEXT NOT NULL DEFAULT 'unknown',
    title TEXT,
    doc_date TEXT,
    doc_date_method TEXT,
    doc_date_confidence REAL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_extracted_at TEXT,
    extractor_version TEXT,
    chunk_count INTEGER,
    claim_count INTEGER
  );
  CREATE INDEX sources_hash ON sources(hash);
  CREATE TABLE claims (
    id TEXT PRIMARY KEY,
    source_hash TEXT NOT NULL,
    source_path TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    subject_id TEXT,
    predicate TEXT NOT NULL,
    object_kind TEXT NOT NULL,
    object_value TEXT NOT NULL,
    json TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    recorded_at TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    confidence REAL NOT NULL,
    authority REAL NOT NULL,
    extractor_version TEXT NOT NULL,
    superseded_at TEXT
  );
  CREATE INDEX claims_source ON claims(source_hash);
  CREATE INDEX claims_subject ON claims(subject_type, subject_name);
  CREATE INDEX claims_valid_from ON claims(valid_from);
  CREATE TABLE llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    run_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    source_hash TEXT,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd REAL,
    duration_ms INTEGER NOT NULL,
    from_cassette INTEGER NOT NULL
  );
  CREATE INDEX llm_calls_ts ON llm_calls(ts);
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    stats_json TEXT
  );
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    path TEXT,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    enqueued_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    error TEXT
  );
  CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    file_name TEXT,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE aliases (
    alias TEXT NOT NULL,
    type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    PRIMARY KEY (alias, type)
  );
  CREATE TABLE review_items (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    state TEXT NOT NULL,
    payload_json TEXT,
    answer_json TEXT,
    created_at TEXT NOT NULL,
    answered_at TEXT
  );
  `,
];

export interface SourceRow {
  path: string;
  hash: string;
  mtimeMs: number;
  size: number;
  triage: TriageState;
  triageReason: string | null;
  sourceType: SourceType;
  title: string | null;
  docDate: DocDate | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastExtractedAt: string | null;
  extractorVersion: string | null;
  chunkCount: number | null;
  claimCount: number | null;
}

interface SourceDbRow {
  path: string;
  hash: string;
  mtime_ms: number;
  size: number;
  triage: TriageState;
  triage_reason: string | null;
  source_type: SourceType;
  title: string | null;
  doc_date: string | null;
  doc_date_method: DocDate['method'] | null;
  doc_date_confidence: number | null;
  first_seen_at: string;
  last_seen_at: string;
  last_extracted_at: string | null;
  extractor_version: string | null;
  chunk_count: number | null;
  claim_count: number | null;
}

export interface LlmCallRecord {
  ts: string;
  runId: string | null;
  provider: string;
  model: string;
  purpose: string;
  sourceHash: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  durationMs: number;
  fromCassette: boolean;
}

export interface CostSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unknownCostCalls: number;
}

function toSourceRow(r: SourceDbRow): SourceRow {
  return {
    path: r.path,
    hash: r.hash,
    mtimeMs: r.mtime_ms,
    size: r.size,
    triage: r.triage,
    triageReason: r.triage_reason,
    sourceType: r.source_type,
    title: r.title,
    docDate:
      r.doc_date && r.doc_date_method
        ? { date: r.doc_date, method: r.doc_date_method, confidence: r.doc_date_confidence ?? 0 }
        : null,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    lastExtractedAt: r.last_extracted_at,
    extractorVersion: r.extractor_version,
    chunkCount: r.chunk_count,
    claimCount: r.claim_count,
  };
}

/** Rebuildable index over the file-based ledger (ADR-002). */
export class StateDb {
  readonly db: Database;

  constructor(file: string) {
    this.db = new Database(file, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.query('PRAGMA user_version').get() as { user_version: number };
    for (let i = row.user_version; i < MIGRATIONS.length; i++) {
      this.db.exec(MIGRATIONS[i] as string);
      this.db.exec(`PRAGMA user_version = ${i + 1}`);
    }
  }

  close(): void {
    this.db.close();
  }

  getSource(path: string): SourceRow | null {
    const r = this.db.query('SELECT * FROM sources WHERE path = ?').get(path) as SourceDbRow | null;
    return r ? toSourceRow(r) : null;
  }

  listSources(): SourceRow[] {
    const rows = this.db.query('SELECT * FROM sources ORDER BY path').all() as SourceDbRow[];
    return rows.map(toSourceRow);
  }

  upsertSource(s: SourceRow): void {
    this.db
      .query(
        `INSERT INTO sources (path, hash, mtime_ms, size, triage, triage_reason, source_type, title,
           doc_date, doc_date_method, doc_date_confidence, first_seen_at, last_seen_at,
           last_extracted_at, extractor_version, chunk_count, claim_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           hash = excluded.hash, mtime_ms = excluded.mtime_ms, size = excluded.size,
           triage = excluded.triage, triage_reason = excluded.triage_reason,
           source_type = excluded.source_type, title = excluded.title,
           doc_date = excluded.doc_date, doc_date_method = excluded.doc_date_method,
           doc_date_confidence = excluded.doc_date_confidence,
           last_seen_at = excluded.last_seen_at, last_extracted_at = excluded.last_extracted_at,
           extractor_version = excluded.extractor_version, chunk_count = excluded.chunk_count,
           claim_count = excluded.claim_count`,
      )
      .run(
        s.path,
        s.hash,
        s.mtimeMs,
        s.size,
        s.triage,
        s.triageReason,
        s.sourceType,
        s.title,
        s.docDate?.date ?? null,
        s.docDate?.method ?? null,
        s.docDate?.confidence ?? null,
        s.firstSeenAt,
        s.lastSeenAt,
        s.lastExtractedAt,
        s.extractorVersion,
        s.chunkCount,
        s.claimCount,
      );
  }

  deleteSource(path: string): void {
    this.db.query('DELETE FROM sources WHERE path = ?').run(path);
  }

  /** Paths currently holding the given content hash. */
  pathsForHash(hash: string): string[] {
    const rows = this.db
      .query('SELECT path FROM sources WHERE hash = ? ORDER BY path')
      .all(hash) as {
      path: string;
    }[];
    return rows.map((r) => r.path);
  }

  upsertClaims(claims: Claim[]): void {
    const stmt = this.db.query(
      `INSERT INTO claims (id, source_hash, source_path, subject_type, subject_name, subject_id,
         predicate, object_kind, object_value, json, valid_from, valid_to, recorded_at, ingested_at,
         confidence, authority, extractor_version, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         json = excluded.json, subject_id = excluded.subject_id, superseded_at = excluded.superseded_at,
         source_path = excluded.source_path`,
    );
    const tx = this.db.transaction((rows: Claim[]) => {
      for (const c of rows) {
        const objectValue = c.object.kind === 'entity' ? c.object.name : c.object.value;
        stmt.run(
          c.id,
          c.sourceHash,
          c.sourcePath,
          c.subject.type,
          c.subject.name,
          c.subject.id ?? null,
          c.predicate,
          c.object.kind,
          objectValue,
          JSON.stringify(c),
          c.validFrom,
          c.validTo ?? null,
          c.recordedAt,
          c.ingestedAt,
          c.confidence,
          c.authority,
          c.extractorVersion,
          c.supersededAt ?? null,
        );
      }
    });
    tx(claims);
  }

  claimsForSource(hash: string): Claim[] {
    const rows = this.db
      .query('SELECT json FROM claims WHERE source_hash = ? ORDER BY id')
      .all(hash) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as Claim);
  }

  /** Every claim in the ledger, superseded ones included, in a stable order. */
  allClaims(): Claim[] {
    const rows = this.db
      .query('SELECT json FROM claims ORDER BY valid_from, recorded_at, source_hash, id')
      .all() as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as Claim);
  }

  countClaims(opts: { live?: boolean } = {}): number {
    const sql = opts.live
      ? 'SELECT COUNT(*) AS n FROM claims WHERE superseded_at IS NULL'
      : 'SELECT COUNT(*) AS n FROM claims';
    return (this.db.query(sql).get() as { n: number }).n;
  }

  recordLlmCall(c: LlmCallRecord): void {
    this.db
      .query(
        `INSERT INTO llm_calls (ts, run_id, provider, model, purpose, source_hash, input_tokens,
           output_tokens, cost_usd, duration_ms, from_cassette)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.ts,
        c.runId,
        c.provider,
        c.model,
        c.purpose,
        c.sourceHash,
        c.inputTokens,
        c.outputTokens,
        c.costUsd,
        c.durationMs,
        c.fromCassette ? 1 : 0,
      );
  }

  costSince(ts: string): CostSummary {
    const r = this.db
      .query(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd,
                SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_cost
         FROM llm_calls WHERE ts >= ? AND from_cassette = 0`,
      )
      .get(ts) as {
      calls: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      unknown_cost: number | null;
    };
    return {
      calls: r.calls,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUsd: r.cost_usd,
      unknownCostCalls: r.unknown_cost ?? 0,
    };
  }

  startRun(id: string, kind: string, at: string): void {
    this.db
      .query('INSERT INTO runs (id, kind, started_at, status) VALUES (?, ?, ?, ?)')
      .run(id, kind, at, 'running');
  }

  finishRun(id: string, status: 'ok' | 'error', stats: unknown, at: string): void {
    this.db
      .query('UPDATE runs SET finished_at = ?, status = ?, stats_json = ? WHERE id = ?')
      .run(at, status, JSON.stringify(stats), id);
  }

  lastRuns(limit = 5): {
    id: string;
    kind: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    stats: unknown;
  }[] {
    const rows = this.db
      .query('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as {
      id: string;
      kind: string;
      started_at: string;
      finished_at: string | null;
      status: string;
      stats_json: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      stats: r.stats_json ? JSON.parse(r.stats_json) : null,
    }));
  }

  sourceCounts(): Record<TriageState, number> {
    const rows = this.db
      .query('SELECT triage, COUNT(*) AS n FROM sources GROUP BY triage')
      .all() as { triage: TriageState; n: number }[];
    const out: Record<TriageState, number> = { work: 0, ignore: 0, unsure: 0 };
    for (const r of rows) out[r.triage] = r.n;
    return out;
  }
}
