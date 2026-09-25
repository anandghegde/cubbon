import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { type ScannedFile, scanFolders } from '../fs/scan.ts';
import { fmtUsd } from '../llm/pricing.ts';
import { mapLimit } from '../util/concurrency.ts';
import { shortHash } from '../util/hash.ts';
import { contractHome } from '../util/paths.ts';
import { isoDate } from '../util/text.ts';
import { type PipelineContext, VAULT_DIRS } from './context.ts';
import { type IngestOutcome, ingestFile } from './ingest.ts';
import { type RenderSummary, renderVault } from './render.ts';

export interface CompileOptions {
  extract: boolean;
  /** Merge and render the vault after ingest. Default true. */
  render?: boolean;
  force?: boolean;
  concurrency?: number;
  folders?: string[];
  onProgress?: (outcome: IngestOutcome, index: number, total: number) => void;
  onScanError?: (p: string, err: unknown) => void;
}

export interface CompileSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scanned: number;
  unchanged: number;
  ignored: number;
  stored: number;
  extracted: number;
  errors: number;
  claims: number;
  costUsd: number | null;
  spendCapHit: boolean;
  outcomes: IngestOutcome[];
  render?: RenderSummary;
  renderError?: string;
}

/** Scan, ingest with bounded concurrency, record the run and append the compile log. */
export async function compile(ctx: PipelineContext, opts: CompileOptions): Promise<CompileSummary> {
  const started = ctx.now();
  const startedAt = started.toISOString();
  const runId = `run_${shortHash(`${startedAt}${Math.random()}`, 10)}`;
  ctx.db.startRun(runId, 'compile', startedAt);

  const files: ScannedFile[] = [];
  const folders = opts.folders ?? ctx.config.watch.folders;
  const scan = scanFolders({
    folders,
    extensions: ctx.config.watch.extensions,
    excludeDirs: ctx.config.watch.excludeDirs,
    excludePaths: [...ctx.config.watch.excludePaths, ctx.vaultPath],
    maxFileBytes: ctx.config.watch.maxFileBytes,
  });
  for await (const f of scan) files.push(f);

  const dayStart = `${isoDate(started)}T00:00:00.000Z`;
  let spendCapHit = false;
  const budgetAllows = (): boolean => {
    if (ctx.config.limits.dailySpendUsd <= 0) return true;
    const spent = ctx.db.costSince(dayStart).costUsd;
    if (spent >= ctx.config.limits.dailySpendUsd) {
      spendCapHit = true;
      return false;
    }
    return true;
  };

  let done = 0;
  const outcomes = await mapLimit(
    files,
    opts.concurrency ?? ctx.config.limits.concurrency,
    async (f) => {
      let outcome: IngestOutcome;
      try {
        outcome = await ingestFile(ctx, f, {
          extract: opts.extract,
          force: opts.force,
          runId,
          budgetAllows,
        });
      } catch (err) {
        outcome = { path: f.path, status: 'error', error: (err as Error).message };
      }
      done += 1;
      opts.onProgress?.(outcome, done, files.length);
      return outcome;
    },
  );

  let render: RenderSummary | undefined;
  let renderError: string | undefined;
  if (opts.render !== false) {
    try {
      render = await renderVault(ctx);
    } catch (err) {
      renderError = (err as Error).message;
    }
  }

  const finished = ctx.now();
  let costUsd: number | null = 0;
  const summary: CompileSummary = {
    runId,
    startedAt,
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    scanned: files.length,
    unchanged: 0,
    ignored: 0,
    stored: 0,
    extracted: 0,
    errors: 0,
    claims: 0,
    costUsd: 0,
    spendCapHit,
    outcomes,
  };
  if (render) summary.render = render;
  if (renderError) summary.renderError = renderError;
  for (const o of outcomes) {
    if (o.status === 'error') summary.errors += 1;
    else summary[o.status] += 1;
    summary.claims += o.claims ?? 0;
    if (o.status === 'extracted') {
      costUsd =
        costUsd === null || o.costUsd === null || o.costUsd === undefined
          ? null
          : costUsd + o.costUsd;
    }
  }
  summary.costUsd = costUsd;
  const { outcomes: _drop, ...stats } = summary;
  ctx.db.finishRun(
    runId,
    (summary.errors === files.length && files.length > 0) || renderError ? 'error' : 'ok',
    stats,
    summary.finishedAt,
  );
  await appendCompileLog(ctx, summary);
  return summary;
}

/** Compile log by ingested time: log/YYYY-MM-DD.md (PRD FR6.1). */
async function appendCompileLog(ctx: PipelineContext, s: CompileSummary): Promise<void> {
  const dir = path.join(ctx.vaultPath, VAULT_DIRS.log);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${s.startedAt.slice(0, 10)}.md`);
  const lines: string[] = [];
  lines.push(`## ${s.startedAt.slice(11, 19)} UTC · compile ${s.runId}`);
  lines.push('');
  lines.push(
    `Scanned ${s.scanned} · unchanged ${s.unchanged} · ignored ${s.ignored} · stored ${s.stored} · extracted ${s.extracted} · errors ${s.errors} · claims ${s.claims} · cost ${fmtUsd(s.costUsd)} · ${(s.durationMs / 1000).toFixed(1)}s`,
  );
  if (s.render) {
    const r = s.render;
    lines.push(
      `Vault: ${r.entities} entities from ${r.liveClaims} live claims · notes created ${r.created} · updated ${r.updated} · unchanged ${r.unchanged} · open questions ${r.questions}${r.preserved.length ? ` · preserved edits ${r.preserved.length}` : ''}`,
    );
    for (const p of r.preserved) lines.push(`- preserved edit · ${p.path} · block ${p.block}`);
  }
  if (s.renderError) lines.push(`Render failed: ${s.renderError}`);
  if (s.spendCapHit)
    lines.push('', 'Daily spend cap reached: remaining files were stored without extraction.');
  const interesting = s.outcomes.filter((o) => o.status !== 'unchanged');
  if (interesting.length) {
    lines.push('');
    for (const o of interesting.sort((a, b) => a.path.localeCompare(b.path))) {
      const detail =
        o.status === 'extracted'
          ? `${o.claims} claims from ${o.chunks} chunk${o.chunks === 1 ? '' : 's'}${o.dropped ? `, ${o.dropped} dropped` : ''}`
          : o.status === 'error'
            ? `error: ${o.error}`
            : (o.reason ?? '');
      lines.push(
        `- ${o.status} · ${contractHome(o.path)} · ${o.sourceType ?? ''} · ${detail}`.replace(
          / · $/,
          '',
        ),
      );
    }
  }
  lines.push('');
  await appendFile(file, `${lines.join('\n')}\n`, 'utf8');
}
