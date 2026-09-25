import type { ModelSpec } from '../config/schema.ts';
import { AnthropicProvider } from './anthropic.ts';
import { type CassetteMode, CassetteProvider } from './cassette.ts';
import { FakeProvider } from './fake.ts';
import { OllamaProvider } from './ollama.ts';
import { type Provider, ProviderError } from './types.ts';

export interface ProviderFactoryOptions {
  anthropicApiKey?: string;
  cassettes?: { dir: string; mode: CassetteMode };
}

export function createProvider(spec: ModelSpec, opts: ProviderFactoryOptions = {}): Provider {
  let inner: Provider | null = null;
  switch (spec.provider) {
    case 'anthropic': {
      if (!opts.anthropicApiKey) {
        if (opts.cassettes?.mode === 'replay') break;
        throw new ProviderError('no Anthropic API key configured', 'auth');
      }
      inner = new AnthropicProvider(spec.model, {
        apiKey: opts.anthropicApiKey,
        baseUrl: spec.baseUrl,
      });
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

export { AnthropicProvider } from './anthropic.ts';
export { type CassetteFile, type CassetteMode, CassetteProvider } from './cassette.ts';
export { FakeProvider } from './fake.ts';
export { toJsonSchema } from './jsonschema.ts';
export { OllamaProvider } from './ollama.ts';
export { estimateCost, setModelPrice } from './pricing.ts';
export * from './types.ts';
