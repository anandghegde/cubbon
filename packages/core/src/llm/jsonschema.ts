import { z } from 'zod';

/** JSON Schema for a zod schema, as accepted by Anthropic tool definitions and Ollama's format field. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}
