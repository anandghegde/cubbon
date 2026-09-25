import type { Usage } from './types.ts';

interface Price {
  prefix: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * USD per million tokens, matched by the longest prefix. Unknown models return null so cost is
 * reported as unknown, not zero. Local servers report zero usage cost through their provider.
 */
const PRICES: Price[] = [
  { prefix: 'gpt-4.1-nano', inputPerMTok: 0.1, outputPerMTok: 0.4 },
  { prefix: 'gpt-4.1-mini', inputPerMTok: 0.4, outputPerMTok: 1.6 },
  { prefix: 'gpt-4.1', inputPerMTok: 2, outputPerMTok: 8 },
  { prefix: 'gpt-4o-mini', inputPerMTok: 0.15, outputPerMTok: 0.6 },
  { prefix: 'gpt-4o', inputPerMTok: 2.5, outputPerMTok: 10 },
  { prefix: 'gpt-5-nano', inputPerMTok: 0.05, outputPerMTok: 0.4 },
  { prefix: 'gpt-5-mini', inputPerMTok: 0.25, outputPerMTok: 2 },
  { prefix: 'gpt-5', inputPerMTok: 1.25, outputPerMTok: 10 },
  { prefix: 'o4-mini', inputPerMTok: 1.1, outputPerMTok: 4.4 },
  { prefix: 'o3', inputPerMTok: 2, outputPerMTok: 8 },
  { prefix: 'claude-opus-4', inputPerMTok: 15, outputPerMTok: 75 },
  { prefix: 'claude-sonnet-4', inputPerMTok: 3, outputPerMTok: 15 },
  { prefix: 'claude-haiku-4-5', inputPerMTok: 1, outputPerMTok: 5 },
  { prefix: 'claude-3-5-haiku', inputPerMTok: 0.8, outputPerMTok: 4 },
].sort((a, b) => b.prefix.length - a.prefix.length);

const overrides = new Map<string, Price>();

export function setModelPrice(model: string, inputPerMTok: number, outputPerMTok: number): void {
  overrides.set(model, { prefix: model, inputPerMTok, outputPerMTok });
}

export function estimateCost(model: string, usage: Usage): number | null {
  // Gateways such as OpenRouter prefix the vendor: "openai/gpt-4.1-mini".
  const bare = model.includes('/') ? (model.split('/').pop() ?? model) : model;
  const price =
    overrides.get(model) ??
    overrides.get(bare) ??
    PRICES.find((p) => model.startsWith(p.prefix) || bare.startsWith(p.prefix));
  if (!price) return null;
  return (
    (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000
  );
}

/** Dollar amount for logs: four decimals, or two significant digits for sub-cent calls. */
export function fmtUsd(value: number | null): string {
  if (value === null) return 'unknown';
  if (value === 0) return '$0.0000';
  return value >= 0.01 ? `$${value.toFixed(4)}` : `$${Number(value.toPrecision(2))}`;
}
