import type { Span } from '../model/types.ts';

interface Normalized {
  text: string;
  /** Normalized index -> original index. */
  map: number[];
}

const DROPPED = new Set(['*', '_', '`', '#', '>', '“', '”', '"', '‘', '’', "'"]);

function normalize(input: string): Normalized {
  let text = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (/\s/.test(ch)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (DROPPED.has(ch)) continue;
    if (pendingSpace) {
      text += ' ';
      map.push(i);
      pendingSpace = false;
    }
    text += ch.toLowerCase();
    map.push(i);
  }
  return { text, map };
}

/**
 * Locates an evidence excerpt inside chunk text. Exact match first, then a match that ignores
 * whitespace, case and Markdown punctuation, then a prefix match. Null when nothing fits.
 */
export function locateEvidence(text: string, evidence: string): Span | null {
  const trimmed = evidence.trim();
  if (!trimmed) return null;
  const exact = text.indexOf(trimmed);
  if (exact >= 0) return { start: exact, end: exact + trimmed.length, exact: true };

  const nt = normalize(text);
  const ne = normalize(trimmed);
  if (ne.text.length === 0) return null;
  let idx = nt.text.indexOf(ne.text);
  if (idx >= 0) {
    const start = nt.map[idx] as number;
    const end = (nt.map[idx + ne.text.length - 1] as number) + 1;
    return { start, end, exact: false };
  }
  const prefix = ne.text.slice(0, Math.min(40, ne.text.length));
  if (prefix.length < 12) return null;
  idx = nt.text.indexOf(prefix);
  if (idx >= 0) {
    const start = nt.map[idx] as number;
    const end = Math.min(text.length, start + trimmed.length);
    return { start, end, exact: false };
  }
  return null;
}
