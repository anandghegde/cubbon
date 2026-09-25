import { toJsonSchema } from './jsonschema.ts';
import { estimateCost } from './pricing.ts';
import {
  type Provider,
  ProviderError,
  type StructuredRequest,
  type StructuredResponse,
} from './types.ts';

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAIOptions {
  /** Optional for local servers; sent as a bearer token when present. */
  apiKey?: string;
  /** Any OpenAI-compatible endpoint ending in /v1: OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM. */
  baseUrl?: string;
  /** Retries on 429, 5xx and network failures. */
  maxRetries?: number;
  retryBaseMs?: number;
  timeoutMs?: number;
  /** json_schema is tried first and downgraded to json_object when the server rejects it. */
  responseFormat?: 'json_schema' | 'json_object';
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  /**
   * Gateways such as Surplus and OpenRouter report the charged USD cost per call. When the seller
   * brings its own upstream key, `cost` is the gateway fee and the model charge sits in
   * cost_details.upstream_inference_cost.
   */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    cost_details?: { upstream_inference_cost?: number | null };
  };
}

/** True for api.openai.com, where a key is mandatory and the newer parameter names apply. */
export function isOfficialOpenAI(baseUrl: string | undefined): boolean {
  try {
    return new URL(baseUrl ?? OPENAI_DEFAULT_BASE_URL).hostname.endsWith('api.openai.com');
  } catch {
    return false;
  }
}

/**
 * Chat Completions with structured output. Works against any OpenAI-compatible server: strict
 * JSON schema when supported, JSON mode with the schema in the prompt otherwise, and one repair
 * round when the model's JSON fails validation.
 */
export class OpenAIProvider implements Provider {
  readonly name = 'openai';
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private format: 'json_schema' | 'json_object';
  private sendTemperature = true;

  constructor(
    readonly model: string,
    opts: OpenAIOptions = {},
  ) {
    this.baseUrl = (opts.baseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.format = opts.responseFormat ?? 'json_schema';
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  /** Reachability probe for `cubbon doctor`: lists models on the endpoint. */
  async probe(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from ${this.baseUrl}/models` };
      const json = (await res.json()) as { data?: { id: string }[] };
      const ids = json.data?.map((m) => m.id) ?? [];
      const hasModel = ids.length === 0 || ids.includes(this.model);
      return {
        ok: hasModel,
        detail: hasModel
          ? `reachable at ${this.baseUrl}${ids.length ? ` (${ids.length} models)` : ''}`
          : `reachable at ${this.baseUrl} but model ${this.model} is not listed`,
      };
    } catch (err) {
      return { ok: false, detail: `not reachable at ${this.baseUrl}: ${(err as Error).message}` };
    }
  }

  async complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = performance.now();
    const schema = toJsonSchema(req.schema);
    const usage = { inputTokens: 0, outputTokens: 0 };
    const messages: ChatMessage[] = [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ];
    let model = this.model;
    let lastIssues = '';
    let reportedCost: number | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.chat(req, schema, messages);
      model = res.model ?? model;
      usage.inputTokens += res.usage?.prompt_tokens ?? 0;
      usage.outputTokens += res.usage?.completion_tokens ?? 0;
      const callCost = reportedCallCost(res.usage);
      if (callCost !== null) reportedCost = (reportedCost ?? 0) + callCost;
      const message = res.choices?.[0]?.message;
      if (!message || typeof message.content !== 'string') {
        throw new ProviderError(
          message?.refusal ? `model refused: ${message.refusal}` : 'response contained no message',
          'validation',
        );
      }
      let data: unknown;
      try {
        data = JSON.parse(stripFences(message.content));
      } catch {
        data = undefined;
        lastIssues = 'response was not valid JSON';
      }
      const parsed = data === undefined ? null : req.schema.safeParse(data);
      if (parsed?.success) {
        return {
          data: parsed.data,
          provider: this.name,
          model,
          usage,
          costUsd: reportedCost ?? estimateCost(model, usage),
          durationMs: Math.round(performance.now() - started),
          fromCassette: false,
        };
      }
      if (parsed) {
        lastIssues = parsed.error.issues
          .slice(0, 10)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
      }
      messages.push({ role: 'assistant', content: message.content });
      messages.push({
        role: 'user',
        content: `The JSON did not match the ${req.schemaName} schema: ${lastIssues}. Return the corrected JSON object only.`,
      });
    }
    throw new ProviderError(`schema validation failed after repair: ${lastIssues}`, 'validation');
  }

  private body<T>(req: StructuredRequest<T>, schema: unknown, messages: ChatMessage[]): string {
    const maxTokens = req.maxTokens ?? 8192;
    const msgs =
      this.format === 'json_object'
        ? messages.map((m, i) =>
            i === 0 && m.role === 'system'
              ? {
                  ...m,
                  content: `${m.content}\n\nRespond with a single JSON object and nothing else. It must match this JSON Schema exactly:\n${JSON.stringify(schema)}`,
                }
              : m,
          )
        : messages;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: msgs,
      response_format:
        this.format === 'json_schema'
          ? {
              type: 'json_schema',
              json_schema: {
                name: req.schemaName,
                description: req.schemaDescription,
                schema,
              },
            }
          : { type: 'json_object' },
    };
    if (isOfficialOpenAI(this.baseUrl)) body.max_completion_tokens = maxTokens;
    else body.max_tokens = maxTokens;
    if (this.sendTemperature) body.temperature = req.temperature ?? 0;
    return JSON.stringify(body);
  }

  /** One logical call with transport retries and parameter downgrades on 400s. */
  private async chat<T>(
    req: StructuredRequest<T>,
    schema: unknown,
    messages: ChatMessage[],
  ): Promise<ChatCompletion> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: this.body(req, schema, messages),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw new ProviderError(`could not reach ${this.baseUrl}`, 'transport', err);
      }
      if (res.ok) return (await res.json()) as ChatCompletion;

      const text = await res.text();
      if (res.status === 400) {
        if (this.format === 'json_schema' && /response_format|json_schema|schema/i.test(text)) {
          this.format = 'json_object';
          continue;
        }
        if (this.sendTemperature && /temperature/i.test(text)) {
          this.sendTemperature = false;
          continue;
        }
      }
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError(
          `authentication failed at ${this.baseUrl} (HTTP ${res.status}); check the API key`,
          'auth',
        );
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await this.backoff(attempt, res.headers.get('retry-after'));
        continue;
      }
      if (res.status === 429) throw new ProviderError('rate limit reached', 'rate_limit');
      if (res.status >= 500) {
        throw new ProviderError(`${this.baseUrl} returned HTTP ${res.status}`, 'transport');
      }
      throw new ProviderError(
        `${this.baseUrl} returned HTTP ${res.status}: ${errorMessage(text)}`,
        res.status === 404 ? 'unknown' : 'validation',
      );
    }
  }

  private async backoff(attempt: number, retryAfter?: string | null): Promise<void> {
    const hinted = retryAfter ? Number(retryAfter) * 1000 : Number.NaN;
    const ms = Number.isFinite(hinted) ? hinted : this.retryBaseMs * 3 ** attempt;
    await new Promise((r) => setTimeout(r, ms));
  }
}

function reportedCallCost(usage: ChatCompletion['usage']): number | null {
  const parts = [usage?.cost, usage?.cost_details?.upstream_inference_cost].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0);
}

function stripFences(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? (m[1] ?? '') : t;
}

function errorMessage(text: string): string {
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof json.error === 'string') return json.error;
    if (json.error?.message) return json.error.message;
  } catch {
    // not JSON
  }
  return text.slice(0, 300);
}
