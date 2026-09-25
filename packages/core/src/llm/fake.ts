import type { Provider, StructuredRequest, StructuredResponse } from './types.ts';

/** Test double. The handler returns raw data which is validated against the request schema. */
export class FakeProvider implements Provider {
  readonly name = 'fake';
  readonly model = 'fake';
  readonly calls: StructuredRequest<unknown>[] = [];

  constructor(private readonly handler: (req: StructuredRequest<unknown>) => unknown) {}

  async complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    const data = req.schema.parse(this.handler(req as StructuredRequest<unknown>));
    return {
      data,
      provider: this.name,
      model: this.model,
      usage: { inputTokens: Math.ceil((req.system.length + req.user.length) / 4), outputTokens: 0 },
      costUsd: 0,
      durationMs: 0,
      fromCassette: false,
    };
  }
}
