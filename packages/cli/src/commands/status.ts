import path from 'node:path';
import {
  type CostSummary,
  contractHome,
  createContext,
  EntityRegistry,
  fmtUsd,
  loadVaultConfig,
  VAULT_DIRS,
} from '@cubbon/core';
import type { Command } from 'commander';
import { resolveVault } from '../vault.ts';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show vault state: sources, claims, recent runs and spend.')
    .option('--vault <path>', 'vault directory')
    .action(async (opts: { vault?: string }) => {
      const vaultPath = await resolveVault(opts.vault);
      const config = await loadVaultConfig(vaultPath);
      const ctx = createContext(vaultPath, config);
      try {
        const counts = ctx.db.sourceCounts();
        const today = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
        const spend: CostSummary = ctx.db.costSince(today);
        console.log(`Vault: ${contractHome(vaultPath)}`);
        console.log(`Folders: ${config.watch.folders.map(contractHome).join(', ') || '(none)'}`);
        console.log(
          `Extractor: ${config.models.extractor.provider} ${config.models.extractor.model}  version ${ctx.extractorVersion}`,
        );
        console.log('');
        console.log(
          `Sources: work ${counts.work}  unsure ${counts.unsure}  ignored ${counts.ignore}`,
        );
        console.log(
          `Claims: ${ctx.db.countClaims({ live: true })} live, ${ctx.db.countClaims()} total`,
        );
        console.log(
          `Spend today: ${spend.calls} calls, ${spend.inputTokens + spend.outputTokens} tokens, ${fmtUsd(spend.costUsd)}${spend.unknownCostCalls ? ` (+${spend.unknownCostCalls} calls with unknown price)` : ''} of $${config.limits.dailySpendUsd} cap`,
        );
        const entityDir = path.join(vaultPath, VAULT_DIRS.entities);
        const registry = await EntityRegistry.load(entityDir);
        const byType = new Map<string, number>();
        for (const e of Object.values(registry.entries))
          byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
        if (byType.size) {
          console.log(
            `Entities: ${[...byType.entries()]
              .sort()
              .map(([t, n]) => `${t} ${n}`)
              .join('  ')}`,
          );
        }
        const runs = ctx.db.lastRuns(5);
        if (runs.length) {
          console.log('');
          console.log('Recent runs:');
          for (const r of runs) {
            const s = (r.stats ?? {}) as Record<string, unknown>;
            console.log(
              `  ${r.startedAt}  ${r.status.padEnd(7)} extracted ${s.extracted ?? '-'}  claims ${s.claims ?? '-'}  errors ${s.errors ?? '-'}`,
            );
          }
        }
      } finally {
        ctx.close();
      }
    });
}
