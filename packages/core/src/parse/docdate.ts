import path from 'node:path';
import type { DocDate } from '../model/types.ts';
import { isoDate, isValidISODate } from '../util/text.ts';
import { dateFromFilename, findDates } from './dates.ts';

export interface DocDateInput {
  frontmatter: Record<string, unknown> | null;
  filePath: string;
  title: string | null;
  body: string;
  mtimeMs: number;
}

const FRONTMATTER_KEYS = [
  'date',
  'created',
  'created_at',
  'createdAt',
  'creation_date',
  'published',
  'publish_date',
  'published_at',
  'updated',
  'modified',
  'last_modified',
  'lastmod',
];

/** Lines such as "Date: 2026-09-20" or "Last updated September 20, 2026" near the top of a document. */
const LABELLED_LINE =
  /^\s*(?:\*\*)?(?:date|updated|last updated|created|as of|meeting date)(?:\*\*)?\s*[:\-–]?\s*(.+)$/im;

function fromFrontmatterValue(v: unknown): string | null {
  if (v instanceof Date) return isoDate(v);
  if (typeof v === 'string') {
    const head = v.slice(0, 10);
    if (isValidISODate(head)) return head;
    const found = findDates(v);
    return found[0]?.iso ?? null;
  }
  return null;
}

/**
 * Document date inference in the PRD's priority order:
 * frontmatter, filename, title, labelled or first body date, then mtime (low confidence).
 */
export function inferDocDate(input: DocDateInput): DocDate {
  if (input.frontmatter) {
    for (const key of FRONTMATTER_KEYS) {
      if (!(key in input.frontmatter)) continue;
      const date = fromFrontmatterValue(input.frontmatter[key]);
      if (date) return { date, method: 'frontmatter', confidence: 0.95 };
    }
  }
  const fromName = dateFromFilename(path.basename(input.filePath));
  if (fromName) return { date: fromName, method: 'filename', confidence: 0.9 };

  if (input.title) {
    const inTitle = findDates(input.title)[0];
    if (inTitle) return { date: inTitle.iso, method: 'title', confidence: 0.8 };
  }

  const head = input.body.slice(0, 3000);
  const labelled = LABELLED_LINE.exec(head);
  if (labelled?.[1]) {
    const d = findDates(labelled[1])[0];
    if (d?.precision === 'day') return { date: d.iso, method: 'body', confidence: 0.7 };
  }
  const first = findDates(input.body).find((d) => d.precision === 'day');
  if (first) return { date: first.iso, method: 'body', confidence: 0.5 };

  return { date: isoDate(new Date(input.mtimeMs)), method: 'mtime', confidence: 0.3 };
}
