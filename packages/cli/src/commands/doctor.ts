import {
  contractHome,
  loadGlobalConfig,
  loadVaultConfig,
  OllamaProvider,
  resolveAnthropicApiKey,
} from '@cubbon/core';
import type { Command } from 'commander';
import { resolveVault } from '../vault.ts';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check runtime, configuration and model connectivity.')
    .option('--vault <path>', 'vault directory')
    .action(async (opts: { vault?: string }) => {
      const checks: { name: string; ok: boolean; detail: string }[] = [];
      checks.push({
        name: 'runtime',
        ok: typeof Bun !== 'undefined',
        detail: typeof Bun !== 'undefined' ? `bun ${Bun.version}` : 'not running under Bun',
      });
      let vaultPath: string | null = null;
      try {
        vaultPath = await resolveVault(opts.vault);
        const config = await loadVaultConfig(vaultPath);
        checks.push({
          name: 'vault',
          ok: true,
          detail: `${contractHome(vaultPath)}, ${config.watch.folders.length} folders`,
        });
        const global = await loadGlobalConfig();
        if (config.models.extractor.provider === 'anthropic') {
          const key = resolveAnthropicApiKey(global);
          checks.push({
            name: 'anthropic key',
            ok: Boolean(key),
            detail: key ? `present (${key.slice(0, 8)}…)` : 'ANTHROPIC_API_KEY not set',
          });
        }
        if (
          config.models.triage.provider === 'ollama' ||
          config.models.extractor.provider === 'ollama'
        ) {
          const spec =
            config.models.extractor.provider === 'ollama'
              ? config.models.extractor
              : config.models.triage;
          const ollama = new OllamaProvider(spec.model, spec.baseUrl);
          const up = await ollama.available();
          checks.push({
            name: 'ollama',
            ok: up,
            detail: up
              ? `reachable at ${spec.baseUrl ?? 'http://localhost:11434'}`
              : 'not reachable (local triage and local-only mode unavailable)',
          });
        }
      } catch (err) {
        checks.push({ name: 'vault', ok: false, detail: (err as Error).message });
      }
      for (const c of checks)
        console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(14)} ${c.detail}`);
      if (checks.some((c) => !c.ok && c.name !== 'ollama')) process.exitCode = 1;
    });
}
