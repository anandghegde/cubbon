import path from 'node:path';
import type { VaultConfig } from '../config/schema.ts';
import { extractorVersion } from '../extract/ids.ts';
import { buildSystemPrompt } from '../extract/prompt.ts';
import { ExtractionOutputSchema } from '../extract/schema.ts';
import { RawStore } from '../fs/rawStore.ts';
import { toJsonSchema } from '../llm/jsonschema.ts';
import type { Provider } from '../llm/types.ts';
import type { OwnerIdentity } from '../model/types.ts';
import { ClaimStore } from '../state/claimStore.ts';
import { StateDb } from '../state/db.ts';

export interface PipelineContext {
  vaultPath: string;
  config: VaultConfig;
  db: StateDb;
  raw: RawStore;
  claims: ClaimStore;
  /** Null when no extractor is configured or reachable; ingest then stores without extracting. */
  provider: Provider | null;
  systemPrompt: string;
  extractorVersion: string;
  owner: OwnerIdentity;
  now: () => Date;
  close(): void;
}

export const VAULT_DIRS = {
  cubbon: '.cubbon',
  claims: '.cubbon/claims',
  entities: '.cubbon/entities',
  logs: '.cubbon/logs',
  raw: 'raw',
  wiki: 'wiki',
  days: 'days',
  digests: 'digests',
  log: 'log',
  bases: 'bases',
  canvas: 'canvas',
} as const;

export function ownerFromConfig(config: VaultConfig): OwnerIdentity {
  const owner: OwnerIdentity = { name: config.owner.name, aliases: config.owner.aliases };
  if (config.owner.email) owner.email = config.owner.email;
  if (config.owner.organization) owner.organization = config.owner.organization;
  return owner;
}

export function createContext(
  vaultPath: string,
  config: VaultConfig,
  opts: { provider?: Provider | null; now?: () => Date } = {},
): PipelineContext {
  const owner = ownerFromConfig(config);
  const systemPrompt = buildSystemPrompt(owner);
  const schemaJson = JSON.stringify(toJsonSchema(ExtractionOutputSchema));
  const db = new StateDb(path.join(vaultPath, VAULT_DIRS.cubbon, 'state.db'));
  return {
    vaultPath,
    config,
    db,
    raw: new RawStore(path.join(vaultPath, VAULT_DIRS.raw)),
    claims: new ClaimStore(path.join(vaultPath, VAULT_DIRS.claims)),
    provider: opts.provider ?? null,
    systemPrompt,
    extractorVersion: extractorVersion(systemPrompt, schemaJson),
    owner,
    now: opts.now ?? (() => new Date()),
    close: () => db.close(),
  };
}
