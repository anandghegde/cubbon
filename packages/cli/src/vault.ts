import path from 'node:path';
import {
  type CassetteMode,
  createContext,
  createProvider,
  findVault,
  loadGlobalConfig,
  loadVaultConfig,
  type PipelineContext,
  type Provider,
  resolveAnthropicApiKey,
  type VaultConfig,
} from '@cubbon/core';

export async function resolveVault(explicit?: string): Promise<string> {
  if (explicit) return path.resolve(explicit);
  const found = await findVault(process.cwd());
  if (found) return found;
  const global = await loadGlobalConfig();
  if (global.defaultVault) return path.resolve(global.defaultVault);
  throw new Error('no vault found: run `cubbon init <path>` or pass --vault');
}

export interface OpenOptions {
  vault?: string;
  extract: boolean;
  cassettes?: CassetteMode;
}

export async function openContext(
  opts: OpenOptions,
): Promise<{ vaultPath: string; config: VaultConfig; ctx: PipelineContext; providerNote: string }> {
  const vaultPath = await resolveVault(opts.vault);
  const config = await loadVaultConfig(vaultPath);
  let provider: Provider | null = null;
  let providerNote = 'extraction off';
  if (opts.extract) {
    const global = await loadGlobalConfig();
    const spec = config.models.extractor;
    if (config.models.localOnly && spec.provider !== 'ollama') {
      throw new Error('models.localOnly is set but models.extractor.provider is not ollama');
    }
    const mode =
      opts.cassettes ?? (config.cassettes.mode === 'off' ? undefined : config.cassettes.mode);
    const cassettes = mode
      ? { dir: config.cassettes.dir ?? path.join(vaultPath, '.cubbon', 'cassettes'), mode }
      : undefined;
    provider = createProvider(spec, { anthropicApiKey: resolveAnthropicApiKey(global), cassettes });
    providerNote = `${provider.name} ${provider.model}`;
  }
  const ctx = createContext(vaultPath, config, { provider });
  return { vaultPath, config, ctx, providerNote };
}
