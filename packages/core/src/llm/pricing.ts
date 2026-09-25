import type { Usage } from './types.ts';

interface Price {
  prefix: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

/** USD per million tokens. Unknown models return null so cost is reported as unknown, not zero. */
const PRICES: Price[] = [
  { prefix: 'claude-opus-4', inputPerMTok: 15, outputPerMTok: 75 },
  { prefix: 'claude-sonnet-4', inputPerMTok: 3, outputPerMTok: 15 },
  { prefix: 'claude-haiku-4-5', inputPerMTok: 1, outputPerMTok: 5 },
  { prefix: 'claude-3-5-haiku', inputPerMTok: 0.8, outputPerMTok: 4 },
];

const overrides = new Map<string, Price>();

export function setModelPrice(model: string, inputPerMTok: number, outputPerMTok: number): void {
  overrides.set(model, { prefix: model, inputPerMTok, outputPerMTok });
}

export function estimateCost(model: string, usage: Usage): number | null {
  const price = overrides.get(model) ?? PRICES.find((p) => model.startsWith(p.prefix));
  if (!price) return null;
  return (
    (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000
  );
}
