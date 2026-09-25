import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FakeProvider } from '../src/llm/fake.ts';
import type { StructuredRequest } from '../src/llm/types.ts';
import type { Claim } from '../src/model/types.ts';

export async function tempDir(
  prefix = 'cubbon-',
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export const FIXTURE_DOC = path.resolve(
  import.meta.dir,
  '../../../fixtures/golden/docs/sprint-2026-09-20.md',
);

/** Extraction output a good model would produce for the sprint fixture. */
export function sprintExtraction() {
  const payments = { type: 'project', name: 'Payments Revamp' } as const;
  const search = { type: 'project', name: 'Search Relevance' } as const;
  return {
    entities: [
      { type: 'project', name: 'Payments Revamp', aliases: [], description: null },
      { type: 'project', name: 'Search Relevance', aliases: [], description: null },
      { type: 'person', name: 'Priya Nair', aliases: ['Priya'], description: null },
      { type: 'person', name: 'Marcus Chen', aliases: [], description: null },
    ],
    claims: [
      {
        subject: payments,
        predicate: 'status',
        object: { kind: 'status', value: 'at-risk' },
        valid_from: null,
        valid_to: null,
        evidence: 'Status: at risk',
        confidence: 0.95,
      },
      {
        subject: payments,
        predicate: 'owner',
        object: { kind: 'entity', type: 'person', name: 'Priya Nair' },
        valid_from: null,
        valid_to: null,
        evidence: 'Owner: Priya Nair',
        confidence: 0.95,
      },
      {
        subject: payments,
        predicate: 'target_date',
        object: { kind: 'date', value: '2026-11-15', precision: 'day' },
        valid_from: null,
        valid_to: null,
        evidence: 'Beta slipped from Oct 15 to Nov 15',
        confidence: 0.9,
      },
      {
        subject: payments,
        predicate: 'target_date',
        object: { kind: 'date', value: '2026-10-15', precision: 'day' },
        valid_from: null,
        valid_to: '2026-09-20',
        evidence: 'Beta slipped from Oct 15 to Nov 15',
        confidence: 0.8,
      },
      {
        subject: { type: 'blocker', name: 'Fraud vendor contract unsigned' },
        predicate: 'blocks',
        object: { kind: 'entity', type: 'project', name: 'Payments Revamp' },
        valid_from: null,
        valid_to: null,
        evidence: 'the fraud vendor contract is still unsigned',
        confidence: 0.85,
      },
      {
        subject: { type: 'commitment', name: 'Send revised contract to Legal' },
        predicate: 'assignee',
        object: { kind: 'entity', type: 'person', name: 'Priya Nair' },
        valid_from: null,
        valid_to: null,
        evidence: 'Priya to send the revised contract to Legal by Sep 25.',
        confidence: 0.9,
      },
      {
        subject: { type: 'commitment', name: 'Send revised contract to Legal' },
        predicate: 'due',
        object: { kind: 'date', value: '2026-09-25', precision: 'day' },
        valid_from: null,
        valid_to: null,
        evidence: 'Priya to send the revised contract to Legal by Sep 25.',
        confidence: 0.9,
      },
      {
        subject: { type: 'commitment', name: 'Send revised contract to Legal' },
        predicate: 'part_of',
        object: { kind: 'entity', type: 'project', name: 'Payments Revamp' },
        valid_from: null,
        valid_to: null,
        evidence: 'Priya to send the revised contract to Legal by Sep 25.',
        confidence: 0.8,
      },
      {
        subject: search,
        predicate: 'status',
        object: { kind: 'status', value: 'on-track' },
        valid_from: null,
        valid_to: null,
        evidence: 'Status: on track',
        confidence: 0.95,
      },
      {
        subject: search,
        predicate: 'target_date',
        object: { kind: 'date', value: '2026-10-30', precision: 'day' },
        valid_from: null,
        valid_to: null,
        evidence: 'Launch remains Oct 30',
        confidence: 0.9,
      },
      {
        subject: { type: 'decision', name: 'Ship without personalization in v1' },
        predicate: 'decided',
        object: { kind: 'text', value: 'Ship Search Relevance v1 without personalization' },
        valid_from: '2026-09-18',
        valid_to: null,
        evidence: 'we will ship without personalization in v1 (Anita, Sep 18)',
        confidence: 0.9,
      },
      // Invalid: a project cannot be the subject of `blocks`. Must be dropped.
      {
        subject: payments,
        predicate: 'blocks',
        object: { kind: 'entity', type: 'project', name: 'Search Relevance' },
        valid_from: null,
        valid_to: null,
        evidence: 'Status: at risk',
        confidence: 0.3,
      },
      // Evidence that is not in the document. Must fall back to the chunk span and lose confidence.
      {
        subject: search,
        predicate: 'team',
        object: { kind: 'text', value: 'Discovery' },
        valid_from: null,
        valid_to: null,
        evidence: 'The Discovery team owns search.',
        confidence: 0.9,
      },
    ],
    unresolved_dates: [],
    open_questions: [],
  };
}

/** A provider that answers the sprint fixture and returns nothing for anything else. */
export function sprintProvider(): FakeProvider {
  return new FakeProvider((req: StructuredRequest<unknown>) =>
    req.user.includes('Payments Revamp')
      ? sprintExtraction()
      : { entities: [], claims: [], unresolved_dates: [], open_questions: [] },
  );
}

let claimSeq = 0;

/** A live claim with sensible defaults; ids are sequential unless given. */
export function makeClaim(extra: Partial<Claim> = {}): Claim {
  claimSeq += 1;
  return {
    id: `clm_${String(claimSeq).padStart(16, '0')}`,
    subject: { type: 'project', name: 'Payments Revamp' },
    predicate: 'status',
    object: { kind: 'status', value: 'on-track' },
    validFrom: '2026-09-20',
    recordedAt: '2026-09-20',
    ingestedAt: '2026-09-25T00:00:00.000Z',
    sourceHash: 'hash-a',
    sourcePath: '/docs/a.md',
    span: { start: 0, end: 5, exact: true },
    evidence: 'evidence',
    confidence: 0.9,
    authority: 0.6,
    extractorVersion: 'v1',
    model: 'fake',
    ...extra,
  };
}
