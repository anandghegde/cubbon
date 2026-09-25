import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import path from 'node:path';
import type { Claim } from '../src/model/types.ts';
import { ClaimStore } from '../src/state/claimStore.ts';
import { StateDb } from '../src/state/db.ts';
import { tempDir } from './helpers.ts';

let dir: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ dir, cleanup } = await tempDir());
});
afterAll(() => cleanup());

function claim(id: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    subject: { type: 'project', name: 'P' },
    predicate: 'status',
    object: { kind: 'status', value: 'on-track' },
    validFrom: '2026-09-20',
    recordedAt: '2026-09-20',
    ingestedAt: '2026-09-25T00:00:00.000Z',
    sourceHash: 'abc',
    sourcePath: '/p.md',
    span: { start: 0, end: 5, exact: true },
    evidence: 'x',
    confidence: 0.9,
    authority: 0.6,
    extractorVersion: 'v1',
    model: 'fake',
    ...extra,
  };
}

describe('StateDb', () => {
  test('migrates, upserts sources and claims, aggregates cost', () => {
    const db = new StateDb(path.join(dir, 'state.db'));
    db.upsertSource({
      path: '/p.md',
      hash: 'abc',
      mtimeMs: 1,
      size: 2,
      triage: 'work',
      triageReason: null,
      sourceType: 'document',
      title: 'P',
      docDate: { date: '2026-09-20', method: 'frontmatter', confidence: 0.95 },
      firstSeenAt: 't',
      lastSeenAt: 't',
      lastExtractedAt: null,
      extractorVersion: null,
      chunkCount: null,
      claimCount: null,
    });
    expect(db.getSource('/p.md')?.docDate?.method).toBe('frontmatter');
    expect(db.pathsForHash('abc')).toEqual(['/p.md']);
    db.upsertClaims([claim('clm_1'), claim('clm_2', { supersededAt: 'now' })]);
    db.upsertClaims([claim('clm_1', { subject: { type: 'project', name: 'P', id: 'prj_1' } })]);
    expect(db.countClaims()).toBe(2);
    expect(db.countClaims({ live: true })).toBe(1);
    expect(db.claimsForSource('abc').find((c) => c.id === 'clm_1')?.subject.id).toBe('prj_1');
    db.recordLlmCall({
      ts: '2026-09-25T10:00:00Z',
      runId: null,
      provider: 'anthropic',
      model: 'm',
      purpose: 'extract',
      sourceHash: 'abc',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
      durationMs: 5,
      fromCassette: false,
    });
    db.recordLlmCall({
      ts: '2026-09-25T10:00:00Z',
      runId: null,
      provider: 'anthropic',
      model: 'm',
      purpose: 'extract',
      sourceHash: 'abc',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: null,
      durationMs: 5,
      fromCassette: false,
    });
    db.recordLlmCall({
      ts: '2026-09-25T10:00:00Z',
      runId: null,
      provider: 'cassette',
      model: 'm',
      purpose: 'extract',
      sourceHash: 'abc',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0,
      durationMs: 0,
      fromCassette: true,
    });
    const cost = db.costSince('2026-09-25T00:00:00Z');
    expect(cost).toEqual({
      calls: 2,
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.01,
      unknownCostCalls: 1,
    });
    db.startRun('r1', 'compile', 'a');
    db.finishRun('r1', 'ok', { extracted: 1 }, 'b');
    expect(db.lastRuns()[0]).toMatchObject({ id: 'r1', status: 'ok', stats: { extracted: 1 } });
    expect(db.sourceCounts()).toEqual({ work: 1, ignore: 0, unsure: 0 });
    db.close();
    // Reopening runs no migration twice.
    const again = new StateDb(path.join(dir, 'state.db'));
    expect(again.countClaims()).toBe(2);
    again.close();
  });
});

describe('ClaimStore', () => {
  test('reconcile keeps and supersedes, never deletes', async () => {
    const store = new ClaimStore(path.join(dir, 'claims'));
    await store.write('abc', [claim('clm_1'), claim('clm_2')]);
    const merged = await store.reconcile('abc', [claim('clm_2'), claim('clm_3')], 'T1');
    expect(merged.map((c) => [c.id, c.supersededAt ?? null])).toEqual([
      ['clm_2', null],
      ['clm_3', null],
      ['clm_1', 'T1'],
    ]);
    const again = await store.reconcile('abc', [claim('clm_3')], 'T2');
    expect(again.find((c) => c.id === 'clm_1')?.supersededAt).toBe('T1');
    expect(again.find((c) => c.id === 'clm_2')?.supersededAt).toBe('T2');
    const all = await store.supersedeAll('abc', 'T3');
    expect(all.every((c) => c.supersededAt)).toBe(true);
    expect(all.find((c) => c.id === 'clm_3')?.supersededAt).toBe('T3');
    expect(await store.read('missing')).toEqual([]);
  });
});
