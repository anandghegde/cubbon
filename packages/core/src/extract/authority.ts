import type { SourceType } from '../model/types.ts';

/** PRD FR3.5: ticket fields highest, owner email high, documents medium, chat low. */
export const AUTHORITY: Record<SourceType, number> = {
  ticket: 0.9,
  email: 0.8,
  meeting: 0.6,
  document: 0.6,
  chat: 0.4,
  unknown: 0.5,
};

export function authorityFor(type: SourceType, opts: { fromOwner?: boolean } = {}): number {
  const base = AUTHORITY[type];
  if (type === 'email' && opts.fromOwner === false) return 0.6;
  return base;
}
