import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { expandHome } from '../util/paths.ts';
import {
  type GlobalConfig,
  GlobalConfigSchema,
  type ModelSpec,
  type VaultConfig,
  VaultConfigSchema,
} from './schema.ts';

export const CUBBON_DIR = '.cubbon';
export const CONFIG_FILE = 'config.yaml';

export function vaultConfigPath(vaultPath: string): string {
  return path.join(vaultPath, CUBBON_DIR, CONFIG_FILE);
}

export function globalConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(base, 'cubbon', CONFIG_FILE);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Walk up from `start` looking for a vault (a directory containing .cubbon/config.yaml). */
export async function findVault(start: string): Promise<string | null> {
  let dir = path.resolve(start);
  for (;;) {
    if (await exists(vaultConfigPath(dir))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function defaultVaultConfig(): VaultConfig {
  return VaultConfigSchema.parse({});
}

export async function loadVaultConfig(vaultPath: string): Promise<VaultConfig> {
  const raw = await readFile(vaultConfigPath(vaultPath), 'utf8');
  const parsed = VaultConfigSchema.parse(YAML.parse(raw) ?? {});
  parsed.watch.folders = parsed.watch.folders.map((f) => path.resolve(expandHome(f)));
  parsed.watch.excludePaths = parsed.watch.excludePaths.map((f) => path.resolve(expandHome(f)));
  return parsed;
}

export async function writeVaultConfig(vaultPath: string, config: VaultConfig): Promise<void> {
  const file = vaultConfigPath(vaultPath);
  await mkdir(path.dirname(file), { recursive: true });
  const doc = new YAML.Document(config);
  doc.commentBefore = ' Cubbon vault configuration. Edit freely; Cubbon re-reads it on each run.';
  await writeFile(file, doc.toString(), 'utf8');
}

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  const file = globalConfigPath();
  if (!(await exists(file))) return GlobalConfigSchema.parse({});
  const raw = await readFile(file, 'utf8');
  return GlobalConfigSchema.parse(YAML.parse(raw) ?? {});
}

export async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  const file = globalConfigPath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, YAML.stringify(config), { encoding: 'utf8', mode: 0o600 });
}

/**
 * API key for a model spec: the named environment variable (default OPENAI_API_KEY), then the
 * global config. Keychain support is tracked for M0.
 */
export function resolveApiKey(spec: ModelSpec, global: GlobalConfig): string | undefined {
  const envName = spec.apiKeyEnv ?? 'OPENAI_API_KEY';
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  return envName === 'OPENAI_API_KEY' ? global.openaiApiKey : undefined;
}
