import { readFile } from 'node:fs/promises';
import {
  contractHome,
  loadVaultConfig,
  parseDocument,
  scanFolders,
  triageHeuristic,
} from '@cubbon/core';
import type { Command } from 'commander';
import { resolveVault } from '../vault.ts';

export function registerScan(program: Command): void {
  program
    .command('scan')
    .description(
      'List candidate files and how triage would classify them, without changing anything.',
    )
    .option('--vault <path>', 'vault directory')
    .option('-f, --folder <path...>', 'scan only these folders')
    .option('--all', 'include files triage would ignore')
    .action(async (opts: { vault?: string; folder?: string[]; all?: boolean }) => {
      const vaultPath = await resolveVault(opts.vault);
      const config = await loadVaultConfig(vaultPath);
      const counts = { work: 0, unsure: 0, ignore: 0 };
      for await (const f of scanFolders({
        folders: opts.folder ?? config.watch.folders,
        extensions: config.watch.extensions,
        excludeDirs: config.watch.excludeDirs,
        excludePaths: [...config.watch.excludePaths, vaultPath],
        maxFileBytes: config.watch.maxFileBytes,
      })) {
        const parsed = parseDocument(await readFile(f.path, 'utf8'));
        const t = triageHeuristic(
          { path: f.path, size: f.size, parsed },
          { minBytes: config.triage.minBytes, force: config.triage.force },
        );
        counts[t.decision] += 1;
        if (t.decision === 'ignore' && !opts.all) continue;
        console.log(
          `${t.decision.padEnd(6)} ${t.sourceType.padEnd(8)} ${contractHome(f.path)}  (${t.reason})`,
        );
      }
      console.log('');
      console.log(`work ${counts.work}  unsure ${counts.unsure}  ignore ${counts.ignore}`);
    });
}
