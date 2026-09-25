import type { ModelSpec } from '../config/schema.ts';
import { type CassetteMode, CassetteProvider } from './cassette.ts';
import { FakeProvider } from './fake.ts';
import { OllamaProvider } from './ollama.ts';
import { isOfficialOpenAI, OpenAIProvider } from './openai.ts';
import { type Provider, ProviderError } from './types.ts';

export interface ProviderFactoryOptions {
  /** Key for the openai provider. Optional for endpoints other than api.openai.com. */
  apiKey?: string;
  cassettes?: { dir: string; mode: CassetteMode };
}

export function createProvider(spec: ModelSpec, opts: ProviderFactoryOptions = {}): Provider {
  let inner: Provider | null = null;
  switch (spec.provider) {
    case 'openai': {
      if (!opts.apiKey && isOfficialOpenAI(spec.baseUrl)) {
        if (opts.cassettes?.mode === 'replay') break;
        throw new ProviderError(
          `no API key for ${spec.baseUrl ?? 'api.openai.com'}: set ${spec.apiKeyEnv ?? 'OPENAI_API_KEY'} or point models.extractor.baseUrl at a local server`,
          'auth',
        );
      }
      inner = new OpenAIProvider(spec.model, { apiKey: opts.apiKey, baseUrl: spec.baseUrl });
      break;
    }
    case 'ollama':
      inner = new OllamaProvider(spec.model, spec.baseUrl);
      break;
    case 'fake':
      inner = new FakeProvider(() => ({}));
      break;
  }
  if (opts.cassettes) return new CassetteProvider(inner, opts.cassettes.dir, opts.cassettes.mode);
  if (!inner) throw new ProviderError('no provider available', 'unknown');
  return inner;
}

export { type CassetteFile, type CassetteMode, CassetteProvider } from './cassette.ts';
export { FakeProvider } from './fake.ts';
export { toJsonSchema } from './jsonschema.ts';
export { OllamaProvider } from './ollama.ts';
export {
  isOfficialOpenAI,
  OPENAI_DEFAULT_BASE_URL,
  type OpenAIOptions,
  OpenAIProvider,
} from './openai.ts';
export { estimateCost, fmtUsd, setModelPrice } from './pricing.ts';
export * from './types.ts';
