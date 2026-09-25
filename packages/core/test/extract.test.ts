import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { extractChunk } from '../src/extract/extractor.ts';
import { claimId, extractorVersion, normalizeObject } from '../src/extract/ids.ts';
import { buildSystemPrompt } from '../src/extract/prompt.ts';
import { locateEvidence } from '../src/extract/span.ts';
import { chunkDocument } from '../src/parse/chunk.ts';
import { parseDocument } from '../src/parse/markdown.ts';
import { sha256Hex } from '../src/util/hash.ts';
import { FIXTURE_DOC, sprintProvider } from './helpers.ts';

describe('claim ids', () => {
  const subj = { type: 'project', name: 'Payments Revamp' } as const;
  test('stable and sensitive to every input', () => {
    const a = claimId('h1', { start: 1, end: 5 }, subj, 'status', {
      kind: 'status',
      value: 'at-risk',
    });
    expect(a).toMatch(/^clm_[0-9a-f]{16}$/);
    expect(
      claimId('h1', { start: 1, end: 5 }, subj, 'status', { kind: 'status', value: 'at-risk' }),
    ).toBe(a);
    expect(
      claimId('h2', { start: 1, end: 5 }, subj, 'status', { kind: 'status', value: 'at-risk' }),
    ).not.toBe(a);
    expect(
      claimId('h1', { start: 1, end: 6 }, subj, 'status', { kind: 'status', value: 'at-risk' }),
    ).not.toBe(a);
    expect(
      claimId('h1', { start: 1, end: 5 }, { ...subj, name: 'Other' }, 'status', {
        kind: 'status',
        value: 'at-risk',
      }),
    ).not.toBe(a);
    expect(
      claimId('h1', { start: 1, end: 5 }, subj, 'status', { kind: 'status', value: 'blocked' }),
    ).not.toBe(a);
  });
  test('object normalization ignores case and whitespace for text and entity names', () => {
    expect(normalizeObject({ kind: 'text', value: '  Ship  IT ' })).toBe('text:ship it');
    expect(normalizeObject({ kind: 'entity', type: 'person', name: 'Priya  Nair' })).toBe(
      'entity:person:priya nair',
    );
    expect(
      claimId('h', { start: 0, end: 1 }, { type: 'project', name: 'X' }, 'team', {
        kind: 'text',
        value: 'Payments',
      }),
    ).toBe(
      claimId('h', { start: 0, end: 1 }, { type: 'project', name: 'x' }, 'team', {
        kind: 'text',
        value: 'PAYMENTS ',
      }),
    );
  });
  test('extractor version changes with prompt or schema', () => {
    const v = extractorVersion('p', 's');
    expect(v).toHaveLength(8);
    expect(extractorVersion('p2', 's')).not.toBe(v);
    expect(extractorVersion('p', 's2')).not.toBe(v);
  });
});

describe('locateEvidence', () => {
  const text = 'Owner: **Priya Nair**. Status:  at risk.\nBeta slipped from “Oct 15” to Nov 15.';
  test('exact', () => {
    const s = locateEvidence(text, 'Status:  at risk.');
    expect(s).toEqual({
      start: text.indexOf('Status'),
      end: text.indexOf('Status') + 'Status:  at risk.'.length,
      exact: true,
    });
  });
  test('ignores markdown, quotes, case and whitespace', () => {
    const s = locateEvidence(text, 'owner: priya nair. status: at risk');
    expect(s?.exact).toBe(false);
    expect(text.slice(s?.start, s?.end)).toBe('Owner: **Priya Nair**. Status:  at risk');
    const q = locateEvidence(text, 'slipped from "Oct 15" to Nov 15');
    expect(text.slice(q?.start, q?.end)).toBe('slipped from “Oct 15” to Nov 15');
  });
  test('prefix fallback and miss', () => {
    const s = locateEvidence(
      text,
      'Owner: Priya Nair. Status: at risk. Beta slipped from Oct 15 to Dec 25 instead',
    );
    expect(s?.exact).toBe(false);
    expect(s?.start).toBe(0);
    expect(s?.end).toBe(text.length);
    expect(locateEvidence(text, 'completely absent sentence here')).toBeNull();
    expect(locateEvidence(text, '   ')).toBeNull();
  });
});

describe('extractChunk', () => {
  async function run() {
    const content = await readFile(FIXTURE_DOC, 'utf8');
    const doc = parseDocument(content);
    const chunks = chunkDocument(doc);
    const provider = sprintProvider();
    const owner = { name: 'Anand Hegde', aliases: ['Anand'] };
    return extractChunk({
      provider,
      systemPrompt: buildSystemPrompt(owner),
      extractorVersion: 'v1',
      source: {
        hash: sha256Hex(content),
        path: FIXTURE_DOC,
        type: 'document',
        title: doc.title,
        docDate: { date: '2026-09-20', method: 'frontmatter', confidence: 0.95 },
        authority: 0.6,
      },
      owner,
      chunk: chunks[0] as NonNullable<(typeof chunks)[0]>,
      chunkCount: chunks.length,
      ingestedAt: '2026-09-25T00:00:00.000Z',
    });
  }

  test('produces spans, defaults, ids and drops invalid claims', async () => {
    const res = await run();
    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0]?.reason).toContain('subject type project not allowed for blocks');
    expect(res.claims).toHaveLength(12);
    const content = await readFile(FIXTURE_DOC, 'utf8');
    const body = parseDocument(content).body;
    const status = res.claims.find(
      (c) => c.predicate === 'status' && c.subject.name === 'Payments Revamp',
    );
    expect(status?.validFrom).toBe('2026-09-20');
    expect(status?.span.exact).toBe(true);
    expect(body.slice(status?.span.start, status?.span.end)).toBe('Status: at risk');
    const decision = res.claims.find((c) => c.predicate === 'decided');
    expect(decision?.validFrom).toBe('2026-09-18');
    const old = res.claims.find(
      (c) =>
        c.predicate === 'target_date' &&
        c.object.kind === 'date' &&
        c.object.value === '2026-10-15',
    );
    expect(old?.validTo).toBe('2026-09-20');
    const team = res.claims.find((c) => c.predicate === 'team');
    expect(team?.span.exact).toBe(false);
    expect(team?.confidence).toBe(0.5);
    for (const c of res.claims) {
      expect(c.id).toMatch(/^clm_/);
      expect(c.authority).toBe(0.6);
      expect(c.extractorVersion).toBe('v1');
    }
    const starts = res.claims.map((c) => c.span.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  test('is deterministic across runs', async () => {
    const a = await run();
    const b = await run();
    expect(a.claims).toEqual(b.claims);
  });
});
