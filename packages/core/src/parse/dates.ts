import type { DatePrecision, ISODate } from '../model/types.ts';
import { isValidISODate } from '../util/text.ts';

export interface DateMatch {
  iso: ISODate;
  precision: DatePrecision;
  start: number;
  end: number;
  text: string;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(y: number, m: number, d: number): ISODate | null {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return isValidISODate(s) ? s : null;
}

function year4(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

type Rule = { re: RegExp; build: (m: RegExpExecArray) => [ISODate | null, DatePrecision] };

const RULES: Rule[] = [
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    build: (m) => [iso(Number(m[1]), Number(m[2]), Number(m[3])), 'day'],
  },
  {
    re: /\b(\d{4})[/.](\d{1,2})[/.](\d{1,2})\b/g,
    build: (m) => [iso(Number(m[1]), Number(m[2]), Number(m[3])), 'day'],
  },
  {
    re: new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'),
    build: (m) => [iso(Number(m[3]), MONTHS[(m[1] ?? '').toLowerCase()] ?? 0, Number(m[2])), 'day'],
  },
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+(\\d{4})\\b`, 'gi'),
    build: (m) => [iso(Number(m[3]), MONTHS[(m[2] ?? '').toLowerCase()] ?? 0, Number(m[1])), 'day'],
  },
  {
    // Numeric with slashes. US order by default; swapped when the first number cannot be a month.
    re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
    build: (m) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const y = Number(m[3]);
      if (a > 12 && b <= 12) return [iso(y, b, a), 'day'];
      return [iso(y, a, b), 'day'];
    },
  },
  {
    re: new RegExp(`\\b${MONTH}\\.?\\s+(\\d{4})\\b`, 'gi'),
    build: (m) => [iso(Number(m[2]), MONTHS[(m[1] ?? '').toLowerCase()] ?? 0, 1), 'month'],
  },
  {
    re: /\bQ([1-4])\s?(?:'|FY)?(\d{2}|\d{4})\b/g,
    build: (m) => [iso(year4(m[2] ?? ''), (Number(m[1]) - 1) * 3 + 1, 1), 'quarter'],
  },
  {
    re: /\b(\d{4})\s?Q([1-4])\b/g,
    build: (m) => [iso(Number(m[1]), (Number(m[2]) - 1) * 3 + 1, 1), 'quarter'],
  },
];

/** Finds absolute dates in text. Overlapping matches keep the longest one. Sorted by position. */
export function findDates(text: string): DateMatch[] {
  const found: DateMatch[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null = rule.re.exec(text);
    while (m) {
      const [value, precision] = rule.build(m);
      if (value) {
        found.push({
          iso: value,
          precision,
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
        });
      }
      m = rule.re.exec(text);
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: DateMatch[] = [];
  let lastEnd = -1;
  for (const d of found) {
    if (d.start < lastEnd) continue;
    out.push(d);
    lastEnd = d.end;
  }
  return out;
}

const FILENAME_RULES: RegExp[] = [
  /(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)/,
  /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/,
];

/** A date embedded in a file name, such as sprint-2026-09-20.md or 20260920-notes.md. */
export function dateFromFilename(fileName: string): ISODate | null {
  for (const re of FILENAME_RULES) {
    const m = re.exec(fileName);
    if (m) {
      const v = iso(Number(m[1]), Number(m[2]), Number(m[3]));
      if (v) return v;
    }
  }
  return null;
}
