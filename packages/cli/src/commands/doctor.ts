import {
  contractHome,
  isOfficialOpenAI,
  loadGlobalConfig,
  loadVaultConfig,
  OllamaProvider,
  OPENAI_DEFAULT_BASE_URL,
  OpenAIProvider,
  resolveApiKey,
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
        const extractor = config.models.extractor;
        if (extractor.provider === 'openai') {
          const key = resolveApiKey(extractor, global);
          const envName = extractor.apiKeyEnv ?? 'OPENAI_API_KEY';
          const required = isOfficialOpenAI(extractor.baseUrl);
          checks.push({
            name: 'api key',
            ok: Boolean(key) || !required,
            detail: key
              ? `present (${key.slice(0, 6)}…) from ${process.env[envName] ? envName : 'global config'}`
              : required
                ? `${envName} not set`
                : `${envName} not set (not required for ${extractor.baseUrl})`,
          });
          if (key || !required) {
            const probe = await new OpenAIProvider(extractor.model, {
              apiKey: key,
              baseUrl: extractor.baseUrl,
            }).probe();
            checks.push({
              name: 'extractor',
              ok: probe.ok,
              detail: `${extractor.model}: ${probe.detail}`,
            });
          } else {
            checks.push({
              name: 'extractor',
              ok: false,
              detail: `${extractor.model} at ${extractor.baseUrl ?? OPENAI_DEFAULT_BASE_URL}: skipped, no key`,
            });
          }
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
