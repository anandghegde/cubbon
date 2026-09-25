import { readFile } from 'node:fs/promises';
import { authorityFor } from '../extract/authority.ts';
import { extractChunk } from '../extract/extractor.ts';
import type { ExtractedEntity } from '../extract/schema.ts';
import type { ScannedFile } from '../fs/scan.ts';
import { ProviderError } from '../llm/types.ts';
import type { Claim } from '../model/types.ts';
import { chunkDocument } from '../parse/chunk.ts';
import { inferDocDate } from '../parse/docdate.ts';
import { parseDocument } from '../parse/markdown.ts';
import type { SourceRow } from '../state/db.ts';
import { triageHeuristic } from '../triage/heuristics.ts';
import { sha256Hex } from '../util/hash.ts';
import type { PipelineContext } from './context.ts';

export type IngestStatus = 'unchanged' | 'ignored' | 'stored' | 'extracted' | 'error';

export interface IngestOutcome {
  path: string;
  status: IngestStatus;
  hash?: string;
  sourceType?: string;
  triage?: string;
  reason?: string;
  chunks?: number;
  claims?: number;
  dropped?: number;
  costUsd?: number | null;
  fromCassette?: boolean;
  error?: string;
  errorKind?: string;
}

export interface IngestOptions {
  extract: boolean;
  force?: boolean;
  runId?: string;
  /** Returns false when the spend cap has been reached. */
  budgetAllows?: () => boolean;
}

/**
 * Ingests one file: change detection, raw store, triage, parse, then extraction into the claim
 * ledger when an extractor is available. Never throws for per-file problems; returns an outcome.
 */
export async function ingestFile(
  ctx: PipelineContext,
  file: ScannedFile,
  opts: IngestOptions,
): Promise<IngestOutcome> {
  const now = ctx.now().toISOString();
  const existing = ctx.db.getSource(file.path);
  const sameStat =
    !opts.force &&
    existing !== null &&
    existing.mtimeMs === file.mtimeMs &&
    existing.size === file.size;

  let content: string | null = null;
  let hash: string;
  if (sameStat && existing) {
    hash = existing.hash;
  } else {
    content = await readFile(file.path, 'utf8');
    hash = sha256Hex(content);
  }

  const contentChanged = existing === null || existing.hash !== hash;
  // Files triaged as ignore are left alone until their content changes or --force re-triages them.
  const needsExtract =
    opts.extract &&
    ctx.provider !== null &&
    (contentChanged ||
      (existing?.triage !== 'ignore' &&
        (existing?.lastExtractedAt === null ||
          existing?.extractorVersion !== ctx.extractorVersion)));

  if (!contentChanged && !needsExtract && !opts.force && existing) {
    if (existing.mtimeMs !== file.mtimeMs || existing.size !== file.size) {
      ctx.db.upsertSource({ ...existing, mtimeMs: file.mtimeMs, size: file.size, lastSeenAt: now });
    }
    return { path: file.path, status: 'unchanged', hash, triage: existing.triage };
  }

  if (content === null) content = await readFile(file.path, 'utf8');
  await ctx.raw.put(hash, content, {
    path: file.path,
    mtimeMs: file.mtimeMs,
    size: file.size,
    now,
  });

  const parsed = parseDocument(content);
  const triage = triageHeuristic(
    { path: file.path, size: file.size, parsed },
    { minBytes: ctx.config.triage.minBytes, force: ctx.config.triage.force },
  );
  const docDate = inferDocDate({
    frontmatter: parsed.frontmatter,
    filePath: file.path,
    title: parsed.title,
    body: parsed.body,
    mtimeMs: file.mtimeMs,
  });

  const row: SourceRow = {
    path: file.path,
    hash,
    mtimeMs: file.mtimeMs,
    size: file.size,
    triage: triage.decision,
    triageReason: triage.reason,
    sourceType: triage.sourceType,
    title: parsed.title,
    docDate,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    lastExtractedAt: contentChanged ? null : (existing?.lastExtractedAt ?? null),
    extractorVersion: contentChanged ? null : (existing?.extractorVersion ?? null),
    chunkCount: contentChanged ? null : (existing?.chunkCount ?? null),
    claimCount: contentChanged ? null : (existing?.claimCount ?? null),
  };
  ctx.db.upsertSource(row);

  if (existing && existing.hash !== hash) await retireOrphanedHash(ctx, existing.hash, now);

  const base: IngestOutcome = {
    path: file.path,
    status: 'stored',
    hash,
    sourceType: triage.sourceType,
    triage: triage.decision,
    reason: triage.reason,
  };
  if (triage.decision === 'ignore') return { ...base, status: 'ignored' };
  if (!opts.extract || ctx.provider === null) return base;
  if (opts.budgetAllows && !opts.budgetAllows()) {
    return { ...base, reason: 'daily spend cap reached; stored without extraction' };
  }

  const chunks = chunkDocument(parsed, ctx.config.limits.maxChunkChars);
  const claims: Claim[] = [];
  const entities: ExtractedEntity[] = [];
  const unresolvedDates: { text: string; evidence: string; reason: string }[] = [];
  const openQuestions: string[] = [];
  const dropped: { reason: string; claim: unknown }[] = [];
  let costUsd: number | null = 0;
  let fromCassette = true;
  let model = ctx.provider.model;
  const source = {
    hash,
    path: file.path,
    type: triage.sourceType,
    title: parsed.title,
    docDate,
    authority: authorityFor(triage.sourceType),
  };
  try {
    for (const chunk of chunks) {
      const result = await extractChunk({
        provider: ctx.provider,
        systemPrompt: ctx.systemPrompt,
        extractorVersion: ctx.extractorVersion,
        source,
        owner: ctx.owner,
        chunk,
        chunkCount: chunks.length,
        ingestedAt: now,
      });
      ctx.db.recordLlmCall({
        ts: ctx.now().toISOString(),
        runId: opts.runId ?? null,
        provider: ctx.provider.name,
        model: result.model,
        purpose: 'extract',
        sourceHash: hash,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd: result.fromCassette ? 0 : result.costUsd,
        durationMs: 0,
        fromCassette: result.fromCassette,
      });
      claims.push(...result.claims);
      entities.push(...result.entities);
      unresolvedDates.push(...result.unresolvedDates);
      openQuestions.push(...result.openQuestions);
      dropped.push(...result.dropped);
      model = result.model;
      fromCassette = fromCassette && result.fromCassette;
      costUsd = costUsd === null || result.costUsd === null ? null : costUsd + result.costUsd;
    }
  } catch (err) {
    const kind = err instanceof ProviderError ? err.kind : 'unknown';
    return { ...base, status: 'error', error: (err as Error).message, errorKind: kind };
  }

  const merged = await ctx.claims.reconcile(hash, claims, now);
  ctx.db.upsertClaims(merged);
  await ctx.claims.writeMeta({
    sourceHash: hash,
    sourcePath: file.path,
    extractorVersion: ctx.extractorVersion,
    extractedAt: now,
    model,
    chunkCount: chunks.length,
    entities,
    unresolvedDates,
    openQuestions,
    dropped,
  });
  ctx.db.upsertSource({
    ...row,
    lastExtractedAt: now,
    extractorVersion: ctx.extractorVersion,
    chunkCount: chunks.length,
    claimCount: claims.length,
  });
  return {
    ...base,
    status: 'extracted',
    chunks: chunks.length,
    claims: claims.length,
    dropped: dropped.length,
    costUsd,
    fromCassette,
  };
}

/** Content that no path holds any more has its claims marked superseded, never deleted. */
async function retireOrphanedHash(ctx: PipelineContext, hash: string, now: string): Promise<void> {
  if (ctx.db.pathsForHash(hash).length > 0) return;
  const updated = await ctx.claims.supersedeAll(hash, now);
  if (updated.length) ctx.db.upsertClaims(updated);
}
