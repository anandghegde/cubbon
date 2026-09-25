import YAML from 'yaml';

export interface FrontmatterResult {
  data: Record<string, unknown> | null;
  raw: string | null;
  body: string;
  /** Offset of `body` within the original text. */
  bodyOffset: number;
  error?: string;
}

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text: string): FrontmatterResult {
  let offset = 0;
  if (text.charCodeAt(0) === 0xfeff) {
    offset = 1;
  }
  const source = text.slice(offset);
  const m = FM_RE.exec(source);
  if (!m) return { data: null, raw: null, body: source, bodyOffset: offset };
  const raw = m[1] ?? '';
  const bodyOffset = offset + m[0].length;
  const body = source.slice(m[0].length);
  try {
    const parsed: unknown = YAML.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, raw, body, bodyOffset };
    }
    return { data: null, raw, body, bodyOffset, error: 'frontmatter is not a mapping' };
  } catch (err) {
    return { data: null, raw, body, bodyOffset, error: (err as Error).message };
  }
}
