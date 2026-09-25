import type { z } from 'zod';

export interface StructuredRequest<T> {
  /** What the call is for: extract, triage, digest. Recorded with cost. */
  purpose: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  schemaDescription?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredResponse<T> {
  data: T;
  provider: string;
  model: string;
  usage: Usage;
  /** Null when the price for the model is unknown. */
  costUsd: number | null;
  durationMs: number;
  fromCassette: boolean;
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

export type ProviderErrorKind = 'validation' | 'transport' | 'auth' | 'rate_limit' | 'unknown';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
