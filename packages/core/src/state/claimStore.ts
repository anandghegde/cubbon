import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExtractedEntity } from '../extract/schema.ts';
import type { Claim } from '../model/types.ts';

export interface ExtractionMeta {
  sourceHash: string;
  sourcePath: string;
  extractorVersion: string;
  extractedAt: string;
  model: string;
  chunkCount: number;
  entities: ExtractedEntity[];
  unresolvedDates: { text: string; evidence: string; reason: string }[];
  openQuestions: string[];
  dropped: { reason: string; claim: unknown }[];
}

/**
 * Canonical claim ledger: one JSONL file per source hash under .cubbon/claims/<hh>/<hash>.jsonl,
 * with extraction side outputs next to it. The SQLite index is derived from these files.
 */
export class ClaimStore {
  constructor(readonly root: string) {}

  fileFor(hash: string): string {
    return path.join(this.root, hash.slice(0, 2), `${hash}.jsonl`);
  }

  metaFileFor(hash: string): string {
    return path.join(this.root, hash.slice(0, 2), `${hash}.meta.json`);
  }

  async read(hash: string): Promise<Claim[]> {
    let text: string;
    try {
      text = await readFile(this.fileFor(hash), 'utf8');
    } catch {
      return [];
    }
    return text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Claim);
  }

  async write(hash: string, claims: Claim[]): Promise<void> {
    const file = this.fileFor(hash);
    await mkdir(path.dirname(file), { recursive: true });
    const body = claims.map((c) => JSON.stringify(c)).join('\n');
    await writeFile(file, body.length ? `${body}\n` : '', 'utf8');
  }

  async writeMeta(meta: ExtractionMeta): Promise<void> {
    const file = this.metaFileFor(meta.sourceHash);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }

  async readMeta(hash: string): Promise<ExtractionMeta | null> {
    try {
      return JSON.parse(await readFile(this.metaFileFor(hash), 'utf8')) as ExtractionMeta;
    } catch {
      return null;
    }
  }

  /**
   * Merges a fresh extraction with what was stored before for the same hash. Claims that are no
   * longer produced are kept and marked superseded (PRD FR6.5: nothing is deleted).
   */
  async reconcile(hash: string, fresh: Claim[], now: string): Promise<Claim[]> {
    const previous = await this.read(hash);
    const freshIds = new Set(fresh.map((c) => c.id));
    const kept = previous
      .filter((c) => !freshIds.has(c.id))
      .map((c) => (c.supersededAt ? c : { ...c, supersededAt: now }));
    const merged = [...fresh, ...kept];
    await this.write(hash, merged);
    return merged;
  }

  /** Marks every live claim of a hash superseded, for content that no longer exists at any path. */
  async supersedeAll(hash: string, now: string): Promise<Claim[]> {
    const previous = await this.read(hash);
    const updated = previous.map((c) => (c.supersededAt ? c : { ...c, supersededAt: now }));
    if (updated.length) await this.write(hash, updated);
    return updated;
  }
}
