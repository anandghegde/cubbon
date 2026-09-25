import { toJsonSchema } from './jsonschema.ts';
import {
  type Provider,
  ProviderError,
  type StructuredRequest,
  type StructuredResponse,
} from './types.ts';

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Local models through Ollama's chat endpoint with JSON schema constrained output. */
export class OllamaProvider implements Provider {
  readonly name = 'ollama';

  constructor(
    readonly model: string,
    private readonly baseUrl = 'http://localhost:11434',
  ) {}

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: toJsonSchema(req.schema),
          options: { temperature: req.temperature ?? 0, num_predict: req.maxTokens ?? 4096 },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      });
    } catch (err) {
      throw new ProviderError(`could not reach Ollama at ${this.baseUrl}`, 'transport', err);
    }
    if (!res.ok) {
      throw new ProviderError(`Ollama returned ${res.status}: ${await res.text()}`, 'transport');
    }
    const json = (await res.json()) as OllamaChatResponse;
    let data: unknown;
    try {
      data = JSON.parse(json.message.content);
    } catch (err) {
      throw new ProviderError('Ollama returned non-JSON content', 'validation', err);
    }
    const parsed = req.schema.safeParse(data);
    if (!parsed.success) {
      throw new ProviderError(`schema validation failed: ${parsed.error.message}`, 'validation');
    }
    return {
      data: parsed.data,
      provider: this.name,
      model: json.model,
      usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0 },
      costUsd: 0,
      durationMs: Math.round(performance.now() - started),
      fromCassette: false,
    };
  }
}
