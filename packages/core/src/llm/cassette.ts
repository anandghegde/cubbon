import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shortHash, stableStringify } from '../util/hash.ts';
import { toJsonSchema } from './jsonschema.ts';
import {
  type Provider,
  ProviderError,
  type StructuredRequest,
  type StructuredResponse,
  type Usage,
} from './types.ts';

export type CassetteMode = 'replay' | 'record' | 'auto';

export interface CassetteFile {
  key: string;
  provider: string;
  model: string;
  purpose: string;
  request: { system: string; user: string; schemaName: string };
  response: { data: unknown; model: string; usage: Usage };
  recordedAt: string;
}

/**
 * Records model responses to JSON files keyed by a hash of the request, and replays them.
 * replay: never call the inner provider. record: always call and overwrite. auto: call on miss.
 */
export class CassetteProvider implements Provider {
  readonly name: string;
  readonly model: string;

  constructor(
    private readonly inner: Provider | null,
    private readonly dir: string,
    private readonly mode: CassetteMode,
  ) {
    this.name = inner ? `cassette(${inner.name})` : 'cassette';
    this.model = inner?.model ?? 'cassette';
  }

  static keyFor<T>(req: StructuredRequest<T>): string {
    return shortHash(
      stableStringify({
        system: req.system,
        user: req.user,
        schemaName: req.schemaName,
        schema: toJsonSchema(req.schema),
      }),
      24,
    );
  }

  async complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const key = CassetteProvider.keyFor(req);
    const file = path.join(this.dir, `${key}.json`);
    if (this.mode !== 'record') {
      const hit = await this.read(file);
      if (hit) {
        const parsed = req.schema.safeParse(hit.response.data);
        if (parsed.success) {
          return {
            data: parsed.data,
            provider: hit.provider,
            model: hit.response.model,
            usage: hit.response.usage,
            costUsd: 0,
            durationMs: 0,
            fromCassette: true,
          };
        }
      }
      if (this.mode === 'replay') {
        throw new ProviderError(`no cassette ${key} for ${req.purpose}`, 'unknown');
      }
    }
    if (!this.inner) throw new ProviderError('cassette miss and no live provider', 'unknown');
    const res = await this.inner.complete(req);
    const record: CassetteFile = {
      key,
      provider: res.provider,
      model: res.model,
      purpose: req.purpose,
      request: { system: req.system, user: req.user, schemaName: req.schemaName },
      response: { data: res.data, model: res.model, usage: res.usage },
      recordedAt: new Date().toISOString(),
    };
    await mkdir(this.dir, { recursive: true });
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return res;
  }

  private async read(file: string): Promise<CassetteFile | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as CassetteFile;
    } catch {
      return null;
    }
  }
}
