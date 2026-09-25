import { type CassetteMode, compile, contractHome } from '@cubbon/core';
import type { Command } from 'commander';
import { openContext } from '../vault.ts';

export function registerCompile(program: Command): void {
  program
    .command('compile')
    .description('Scan watched folders and compile changed documents into the vault.')
    .option('--vault <path>', 'vault directory')
    .option('--no-extract', 'store and triage documents without calling a model')
    .option('--force', 're-process every file even if unchanged')
    .option('--no-render', 'ingest only; skip merging and writing the vault')
    .option('-c, --concurrency <n>', 'parallel files', (v) => Number.parseInt(v, 10))
    .option('-f, --folder <path...>', 'scan only these folders this run')
    .option('--cassettes <mode>', 'record, replay or auto (model call recording)')
    .option('-q, --quiet', 'only print the summary')
    .action(
      async (opts: {
        vault?: string;
        extract: boolean;
        render: boolean;
        force?: boolean;
        concurrency?: number;
        folder?: string[];
        cassettes?: CassetteMode;
        quiet?: boolean;
      }) => {
        const { vaultPath, ctx, providerNote } = await openContext({
          vault: opts.vault,
          extract: opts.extract,
          cassettes: opts.cassettes,
        });
        try {
          console.log(`Compiling into ${contractHome(vaultPath)} (${providerNote})`);
          const summary = await compile(ctx, {
            extract: opts.extract,
            render: opts.render,
            force: opts.force,
            concurrency: opts.concurrency,
            folders: opts.folder,
            onProgress: (o, i, n) => {
              if (opts.quiet || o.status === 'unchanged') return;
              const detail =
                o.status === 'extracted'
                  ? `${o.claims} claims`
                  : o.status === 'error'
                    ? o.error
                    : (o.reason ?? '');
              console.log(
                `[${i}/${n}] ${o.status.padEnd(9)} ${contractHome(o.path)}  ${detail ?? ''}`,
              );
            },
          });
          console.log('');
          console.log(
            `scanned ${summary.scanned}  unchanged ${summary.unchanged}  ignored ${summary.ignored}  stored ${summary.stored}  extracted ${summary.extracted}  errors ${summary.errors}`,
          );
          console.log(
            `claims ${summary.claims}  cost ${summary.costUsd === null ? 'unknown' : `$${summary.costUsd.toFixed(4)}`}  time ${(summary.durationMs / 1000).toFixed(1)}s`,
          );
          if (summary.render) {
            const r = summary.render;
            console.log(
              `vault: ${r.entities} entities from ${r.liveClaims} live claims  notes created ${r.created}  updated ${r.updated}  unchanged ${r.unchanged}  open questions ${r.questions}`,
            );
            for (const p of r.preserved)
              console.log(`  preserved your edit in ${p.path} (block ${p.block}) under Notes`);
          }
          if (summary.renderError) {
            console.log(`Render failed: ${summary.renderError}`);
            process.exitCode = 2;
          }
          if (summary.spendCapHit)
            console.log('Daily spend cap reached; some files were stored without extraction.');
          if (summary.errors > 0) {
            const first = summary.outcomes.find((o) => o.status === 'error');
            console.log(`First error: ${first?.error ?? ''}`);
            process.exitCode = 2;
          }
        } finally {
          ctx.close();
        }
      },
    );
}
