import { describe, expect, test } from 'bun:test';
import {
  bestText,
  currentDate,
  currentStatus,
  liveLinks,
  mergeLedger,
} from '../src/merge/merge.ts';
import { EntityRegistry } from '../src/merge/registry.ts';
import type { Claim } from '../src/model/types.ts';
import { makeClaim } from './helpers.ts';

const owner = { name: 'Anand Hegde', email: 'anand@example.com', aliases: ['me'] };

function registry(userAliases = {}): EntityRegistry {
  return new EntityRegistry('/nonexistent/entities', null, userAliases);
}

function merge(
  claims: Claim[],
  opts: { metaEntities?: Record<string, never[]>; reg?: EntityRegistry } = {},
) {
  return mergeLedger({
    claims,
    metaEntities: opts.metaEntities ?? {},
    registry: opts.reg ?? registry(),
    owner,
  });
}

function byName(result: ReturnType<typeof mergeLedger>, name: string) {
  const e = [...result.entities.values()].find((x) => x.name === name);
  if (!e)
    throw new Error(
      `no entity ${name}: ${[...result.entities.values()].map((x) => x.name).join(', ')}`,
    );
  return e;
}

describe('resolution', () => {
  test('normalized names, doc aliases and first-name matches collapse to one person', () => {
    const r = mergeLedger({
      claims: [
        makeClaim({
          predicate: 'owner',
          object: { kind: 'entity', type: 'person', name: 'Priya Nair' },
        }),
        makeClaim({
          subject: { type: 'project', name: 'The Payments Revamp' },
          predicate: 'owner',
          object: { kind: 'entity', type: 'person', name: 'priya  nair' },
        }),
        makeClaim({
          subject: { type: 'commitment', name: 'Send contract' },
          predicate: 'assignee',
          object: { kind: 'entity', type: 'person', name: 'Priya' },
        }),
        makeClaim({
          subject: { type: 'commitment', name: 'Book vendor' },
          predicate: 'assignee',
          object: { kind: 'entity', type: 'person', name: 'PN' },
        }),
      ],
      metaEntities: {
        'hash-a': [{ type: 'person', name: 'Priya Nair', aliases: ['PN'], description: null }],
      },
      registry: registry(),
      owner,
    });
    const people = [...r.entities.values()].filter((e) => e.type === 'person');
    expect(people).toHaveLength(1);
    expect(people[0]?.name).toBe('Priya Nair');
    expect(people[0]?.aliases).toEqual(expect.arrayContaining(['Priya', 'PN']));
    expect([...r.entities.values()].filter((e) => e.type === 'project')).toHaveLength(1);
  });

  test('a fuller name upgrades the canonical name and keeps the short form as alias', () => {
    const r = merge([
      makeClaim({
        predicate: 'owner',
        object: { kind: 'entity', type: 'person', name: 'Marcus' },
        recordedAt: '2026-09-01',
        validFrom: '2026-09-01',
      }),
      makeClaim({
        predicate: 'owner',
        object: { kind: 'entity', type: 'person', name: 'Marcus Chen' },
        recordedAt: '2026-09-10',
        validFrom: '2026-09-10',
      }),
    ]);
    const people = [...r.entities.values()].filter((e) => e.type === 'person');
    expect(people).toHaveLength(1);
    expect(people[0]?.name).toBe('Marcus Chen');
    expect(people[0]?.aliases).toContain('Marcus');
  });

  test('user alias table and owner identity win over name matching', () => {
    const reg = registry({ project: { PR: 'Payments Revamp' } });
    const r = merge(
      [
        makeClaim(),
        makeClaim({
          subject: { type: 'project', name: 'PR' },
          predicate: 'target_date',
          object: { kind: 'date', value: '2026-11-15' },
        }),
        makeClaim({ predicate: 'owner', object: { kind: 'entity', type: 'person', name: 'me' } }),
        makeClaim({
          predicate: 'member',
          object: { kind: 'entity', type: 'person', name: 'anand@example.com' },
        }),
      ],
      { reg },
    );
    expect([...r.entities.values()].filter((e) => e.type === 'project')).toHaveLength(1);
    const people = [...r.entities.values()].filter((e) => e.type === 'person');
    expect(people).toHaveLength(1);
    expect(people[0]?.name).toBe('Anand Hegde');
  });

  test('ids are deterministic and filenames unique across types', () => {
    const claims = [
      makeClaim({ subject: { type: 'project', name: 'Atlas' } }),
      makeClaim({
        subject: { type: 'organization', name: 'Atlas' },
        predicate: 'description',
        object: { kind: 'text', value: 'A vendor' },
      }),
      makeClaim({
        subject: { type: 'milestone', name: 'Beta' },
        predicate: 'part_of',
        object: { kind: 'entity', type: 'project', name: 'Atlas' },
      }),
    ];
    const a = merge(claims);
    const b = merge([...claims].reverse());
    expect([...a.entities.keys()]).toEqual([...b.entities.keys()]);
    const project = [...a.entities.values()].find((e) => e.type === 'project');
    expect(project?.id).toMatch(/^prj_[0-9a-f]{8}$/);
    const files = [...a.entities.values()].map((e) => e.fileName).sort();
    expect(files).toEqual(['Atlas', 'Atlas (2)', 'Atlas – Beta']);
    expect(JSON.stringify([...a.entities.values()])).toBe(JSON.stringify([...b.entities.values()]));
  });
});

describe('status and dates', () => {
  test('same status on the same day from two sources corroborates one entry', () => {
    const r = merge([
      makeClaim({ object: { kind: 'status', value: 'at-risk' }, sourceHash: 'h1', authority: 0.6 }),
      makeClaim({ object: { kind: 'status', value: 'at-risk' }, sourceHash: 'h2', authority: 0.9 }),
      makeClaim({
        object: { kind: 'status', value: 'on-track' },
        validFrom: '2026-09-10',
        recordedAt: '2026-09-10',
      }),
    ]);
    const p = byName(r, 'Payments Revamp');
    expect(p.statusLog.map((s) => [s.date, s.status, s.claims.length])).toEqual([
      ['2026-09-20', 'at-risk', 2],
      ['2026-09-10', 'on-track', 1],
    ]);
    expect(p.statusLog[0]?.claims[0]?.authority).toBe(0.9);
    expect(currentStatus(p)?.status).toBe('at-risk');
    expect(p.sources).toEqual(['h1', 'h2', 'hash-a']);
  });

  test('same-day conflicts: authority wins silently, equal authority raises a question', () => {
    const r = merge([
      makeClaim({
        subject: { type: 'project', name: 'A' },
        object: { kind: 'status', value: 'on-track' },
        authority: 0.9,
        sourceHash: 'ticket',
      }),
      makeClaim({
        subject: { type: 'project', name: 'A' },
        object: { kind: 'status', value: 'blocked' },
        authority: 0.6,
        sourceHash: 'doc',
      }),
      makeClaim({
        subject: { type: 'project', name: 'B' },
        object: { kind: 'status', value: 'on-track' },
        sourceHash: 'd1',
      }),
      makeClaim({
        subject: { type: 'project', name: 'B' },
        object: { kind: 'status', value: 'at-risk' },
        sourceHash: 'd2',
      }),
    ]);
    const a = byName(r, 'A');
    expect(currentStatus(a)?.status).toBe('on-track');
    expect(a.statusLog[1]?.conflict).toBe(true);
    expect(a.questions).toEqual([]);
    const b = byName(r, 'B');
    expect(b.questions).toHaveLength(1);
    expect(b.questions[0]).toContain('sources disagree');
    expect(r.stats.questions).toBe(1);
  });

  test('target date slips keep history and the newest open date wins', () => {
    const r = merge([
      makeClaim({
        predicate: 'target_date',
        object: { kind: 'date', value: '2026-10-15' },
        validFrom: '2026-09-01',
        recordedAt: '2026-09-01',
      }),
      makeClaim({
        predicate: 'target_date',
        object: { kind: 'date', value: '2026-10-15' },
        validTo: '2026-09-20',
        validFrom: '2026-09-20',
        sourceHash: 'h2',
      }),
      makeClaim({
        predicate: 'target_date',
        object: { kind: 'date', value: '2026-11-15' },
        validFrom: '2026-09-20',
        sourceHash: 'h2',
      }),
      makeClaim({
        predicate: 'target_date',
        object: { kind: 'date', value: '2026-11', precision: 'month' },
        validFrom: '2026-09-20',
        sourceHash: 'h2',
      }),
    ]);
    const p = byName(r, 'Payments Revamp');
    const targets = p.dates.target ?? [];
    expect(targets.map((d) => [d.date, d.validTo ?? null, d.claims.length])).toEqual([
      ['2026-10-15', '2026-09-20', 2],
      ['2026-11', null, 1],
      ['2026-11-15', null, 1],
    ]);
    expect(currentDate(p, 'target')?.date).toBe('2026-11-15');
  });

  test('text slots dedupe by normalized text and links carry provenance', () => {
    const r = merge([
      makeClaim({ predicate: 'team', object: { kind: 'text', value: 'Discovery' } }),
      makeClaim({
        predicate: 'team',
        object: { kind: 'text', value: 'the discovery' },
        sourceHash: 'h2',
      }),
      makeClaim({
        subject: { type: 'blocker', name: 'Contract unsigned' },
        predicate: 'blocks',
        object: { kind: 'entity', type: 'project', name: 'Payments Revamp' },
      }),
    ]);
    const p = byName(r, 'Payments Revamp');
    expect(p.texts.team).toHaveLength(1);
    expect(bestText(p, 'team')?.claims).toHaveLength(2);
    const b = byName(r, 'Contract unsigned');
    expect(liveLinks(b, 'blocks').map((l) => l.target)).toEqual([p.id]);
    expect(
      r.claimObjects.get(r.claimSubjects.size ? ([...r.claimSubjects.keys()][2] ?? '') : ''),
    ).toBe(p.id);
  });
});

describe('supersession', () => {
  test('entities with only superseded claims retire; superseded entries stay visible', () => {
    const r = merge([
      makeClaim({
        subject: { type: 'project', name: 'Old Thing' },
        supersededAt: '2026-09-26T00:00:00.000Z',
      }),
      makeClaim({
        object: { kind: 'status', value: 'blocked' },
        validFrom: '2026-09-10',
        recordedAt: '2026-09-10',
        supersededAt: '2026-09-26T00:00:00.000Z',
      }),
      makeClaim({ object: { kind: 'status', value: 'on-track' } }),
    ]);
    expect(byName(r, 'Old Thing').retired).toBe(true);
    const p = byName(r, 'Payments Revamp');
    expect(p.retired).toBe(false);
    expect(p.statusLog.map((s) => [s.status, s.superseded])).toEqual([
      ['on-track', false],
      ['blocked', true],
    ]);
    expect(r.stats).toEqual({ claims: 3, live: 1, entities: 2, questions: 0 });
    expect(r.asOf).toBe('2026-09-20');
  });
});
