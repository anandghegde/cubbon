import YAML from 'yaml';
import type { DatePrecision, ISODate } from '../model/types.ts';

export function fmtDate(date: ISODate, precision: DatePrecision = 'day'): string {
  if (precision === 'year') return date.slice(0, 4);
  if (precision === 'month') return date.slice(0, 7);
  if (precision === 'quarter')
    return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  return date;
}

/** Wikilink by unique filename; Obsidian resolves it from any folder (ADR-003). */
export function link(fileName: string, display?: string): string {
  return display && display !== fileName ? `[[${fileName}|${display}]]` : `[[${fileName}]]`;
}

/** Frontmatter with keys in the given order; undefined values are dropped. */
export function frontmatter(fields: Record<string, unknown>): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    clean[k] = v;
  }
  return `---\n${YAML.stringify(clean, { lineWidth: 0 })}---\n`;
}

/** Keeps generated list lines on one line. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function quote(text: string, max = 120): string {
  const t = oneLine(text);
  return `"${t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t}"`;
}

export function plural(n: number, word: string, words = `${word}s`): string {
  return `${n} ${n === 1 ? word : words}`;
}
