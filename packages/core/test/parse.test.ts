import { describe, expect, test } from 'bun:test';
import { chunkDocument, enclosingHeadings } from '../src/parse/chunk.ts';
import { inferDocDate } from '../src/parse/docdate.ts';
import { splitFrontmatter } from '../src/parse/frontmatter.ts';
import { parseDocument } from '../src/parse/markdown.ts';

describe('frontmatter', () => {
  test('splits and parses yaml, keeps body offsets', () => {
    const text = '---\ntitle: Hello\ndate: 2026-09-20\n---\n# Hello\n\nBody.';
    const fm = splitFrontmatter(text);
    expect(fm.data).toEqual({ title: 'Hello', date: '2026-09-20' });
    expect(fm.body).toBe('# Hello\n\nBody.');
    expect(text.slice(fm.bodyOffset)).toBe(fm.body);
  });

  test('no frontmatter and broken frontmatter', () => {
    expect(splitFrontmatter('# Just a doc').data).toBeNull();
    const broken = splitFrontmatter('---\n: : :\n---\nbody');
    expect(broken.data).toBeNull();
    expect(broken.error).toBeDefined();
    expect(broken.body).toBe('body');
  });
});

describe('parseDocument', () => {
  test('title and headings with offsets', () => {
    const doc = parseDocument('---\ntitle: FM title\n---\n# H1\n\ntext\n\n## H2 *emph*\n\nmore');
    expect(doc.title).toBe('FM title');
    expect(doc.headings.map((h) => [h.depth, h.text])).toEqual([
      [1, 'H1'],
      [2, 'H2 emph'],
    ]);
    const h2 = doc.headings[1];
    expect(doc.body.slice(h2?.start, h2?.end)).toBe('## H2 *emph*');
  });

  test('falls back to first H1', () => {
    expect(parseDocument('## Sub\n\n# Real title\n').title).toBe('Real title');
    expect(parseDocument('plain text').title).toBeNull();
  });
});

describe('inferDocDate', () => {
  const base = {
    frontmatter: null,
    filePath: '/x/notes.md',
    title: null,
    body: '',
    mtimeMs: Date.UTC(2026, 0, 2),
  };
  test('priority order', () => {
    expect(
      inferDocDate({ ...base, frontmatter: { date: '2026-09-20' }, filePath: '/x/2026-01-01.md' })
        .method,
    ).toBe('frontmatter');
    expect(
      inferDocDate({ ...base, filePath: '/x/2026-01-01.md', title: 'Review Sep 5, 2026' }).date,
    ).toBe('2026-01-01');
    expect(
      inferDocDate({ ...base, title: 'Review Sep 5, 2026', body: 'on 2026-02-02' }),
    ).toMatchObject({ date: '2026-09-05', method: 'title' });
    expect(
      inferDocDate({ ...base, body: 'Intro\nLast updated: 12 March 2026\nTarget 2026-11-15' }),
    ).toMatchObject({ date: '2026-03-12', method: 'body', confidence: 0.7 });
    expect(inferDocDate({ ...base, body: 'Target 2026-11-15' })).toMatchObject({
      date: '2026-11-15',
      method: 'body',
      confidence: 0.5,
    });
    expect(inferDocDate(base)).toMatchObject({
      date: '2026-01-02',
      method: 'mtime',
      confidence: 0.3,
    });
  });

  test('frontmatter Date objects and datetimes', () => {
    expect(
      inferDocDate({ ...base, frontmatter: { created: new Date(Date.UTC(2026, 8, 20)) } }).date,
    ).toBe('2026-09-20');
    expect(inferDocDate({ ...base, frontmatter: { date: '2026-09-20T10:00:00Z' } }).date).toBe(
      '2026-09-20',
    );
  });
});

describe('chunkDocument', () => {
  test('small document is one chunk covering the whole body', () => {
    const doc = parseDocument('# T\n\nHello world.\n\n## A\n\nmore');
    const chunks = chunkDocument(doc, 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(doc.body);
    expect(chunks[0]?.headingPath).toEqual([]);
  });

  test('splits at headings and packs small sections', () => {
    const section = (n: number) => `## S${n}\n\n${'x'.repeat(300)}\n\n`;
    const doc = parseDocument(
      `# Title\n\nintro\n\n${section(1)}${section(2)}${section(3)}${section(4)}`,
    );
    const chunks = chunkDocument(doc, 700);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join('')).toBe(doc.body);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(700);
    expect(chunks[1]?.headingPath).toEqual(['Title']);
  });

  test('splits oversized sections by paragraph and then by line', () => {
    const para = `${'word '.repeat(50).trim()}\n\n`;
    const doc = parseDocument(`# Only\n\n${para.repeat(20)}${'longline'.repeat(200)}\n`);
    const chunks = chunkDocument(doc, 600);
    expect(chunks.map((c) => c.text).join('')).toBe(doc.body);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(600);
    expect(chunks.every((c, i) => i === 0 || c.start === chunks[i - 1]?.end)).toBe(true);
    expect(chunks[1]?.headingPath).toEqual(['Only']);
  });

  test('enclosingHeadings excludes a heading starting at the offset', () => {
    const doc = parseDocument('# A\n\n## B\n\ntext\n\n## C\n\nmore');
    const c = doc.headings[2];
    expect(enclosingHeadings(doc.headings, c?.start ?? 0)).toEqual(['A']);
    expect(enclosingHeadings(doc.headings, (c?.start ?? 0) + 1)).toEqual(['A', 'C']);
  });
});
