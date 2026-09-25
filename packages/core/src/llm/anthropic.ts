import Anthropic from '@anthropic-ai/sdk';
import { toJsonSchema } from './jsonschema.ts';
import { estimateCost } from './pricing.ts';
import {
  type Provider,
  ProviderError,
  type StructuredRequest,
  type StructuredResponse,
} from './types.ts';

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
}

/** Structured output through a forced tool call. One repair round on schema mismatch. */
export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    opts: AnthropicOptions,
  ) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      maxRetries: opts.maxRetries ?? 3,
    });
  }

  async complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = performance.now();
    const tool: Anthropic.Tool = {
      name: req.schemaName,
      description: req.schemaDescription ?? `Return the ${req.schemaName} result.`,
      input_schema: toJsonSchema(req.schema) as Anthropic.Tool['input_schema'],
    };
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: req.user }];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let lastIssues = '';

    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Anthropic.Message;
      try {
        res = await this.client.messages.create({
          model: this.model,
          max_tokens: req.maxTokens ?? 8192,
          temperature: req.temperature ?? 0,
          system: req.system,
          messages,
          tools: [tool],
          tool_choice: { type: 'tool', name: req.schemaName },
        });
      } catch (err) {
        throw classify(err);
      }
      usage.inputTokens += res.usage.input_tokens;
      usage.outputTokens += res.usage.output_tokens;
      const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!block) throw new ProviderError('response contained no tool call', 'validation');
      const parsed = req.schema.safeParse(block.input);
      if (parsed.success) {
        return {
          data: parsed.data,
          provider: this.name,
          model: res.model,
          usage,
          costUsd: estimateCost(res.model, usage),
          durationMs: Math.round(performance.now() - started),
          fromCassette: false,
        };
      }
      lastIssues = parsed.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      messages.push({ role: 'assistant', content: res.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: `The input did not match the schema: ${lastIssues}. Call ${req.schemaName} again with corrected input.`,
          },
        ],
      });
    }
    throw new ProviderError(`schema validation failed after repair: ${lastIssues}`, 'validation');
  }
}

function classify(err: unknown): ProviderError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new ProviderError(
      'Anthropic authentication failed; check ANTHROPIC_API_KEY',
      'auth',
      err,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError('Anthropic rate limit reached', 'rate_limit', err);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError('could not reach the Anthropic API', 'transport', err);
  }
  return new ProviderError(err instanceof Error ? err.message : String(err), 'unknown', err);
}
