import type { ExtractableEntityType, Predicate } from './types.ts';

export type ObjectKind = 'status' | 'date' | 'text' | 'entity';

export interface PredicateSpec {
  name: Predicate;
  subject: ExtractableEntityType[];
  object: ObjectKind;
  objectEntity?: ExtractableEntityType[];
  description: string;
}

const WORK_ITEMS: ExtractableEntityType[] = [
  'project',
  'milestone',
  'blocker',
  'decision',
  'commitment',
];
const ALL: ExtractableEntityType[] = [...WORK_ITEMS, 'person', 'organization', 'external'];

/** Single source of truth for what a claim may say. Rendered into the extraction prompt. */
export const PREDICATE_SPECS: readonly PredicateSpec[] = [
  {
    name: 'status',
    subject: ['project', 'milestone'],
    object: 'status',
    description:
      'Status on the valid date, as stated or clearly implied. Use the fixed vocabulary only.',
  },
  {
    name: 'target_date',
    subject: ['project', 'milestone'],
    object: 'date',
    description:
      'Target, due, launch or completion date. Emit a claim every time a date is stated, including slips.',
  },
  {
    name: 'owner',
    subject: ['project', 'milestone', 'blocker'],
    object: 'entity',
    objectEntity: ['person'],
    description: 'The accountable person (owner, DRI, lead).',
  },
  {
    name: 'team',
    subject: ['project'],
    object: 'text',
    description: 'The team or group delivering the project.',
  },
  {
    name: 'member',
    subject: ['project'],
    object: 'entity',
    objectEntity: ['person'],
    description: 'A person working on the project who is not the owner.',
  },
  {
    name: 'part_of',
    subject: ['milestone', 'blocker', 'decision', 'commitment'],
    object: 'entity',
    objectEntity: ['project', 'milestone'],
    description: 'The project or milestone this item belongs to.',
  },
  {
    name: 'blocks',
    subject: ['blocker'],
    object: 'entity',
    objectEntity: ['project', 'milestone'],
    description: 'What the blocker is holding up.',
  },
  {
    name: 'resolved',
    subject: ['blocker'],
    object: 'date',
    description: 'The blocker was resolved or unblocked on this date.',
  },
  {
    name: 'decided',
    subject: ['decision'],
    object: 'text',
    description:
      'The full decision as made. The decision entity name is a short title; the object is the decision text.',
  },
  {
    name: 'assignee',
    subject: ['commitment'],
    object: 'entity',
    objectEntity: ['person'],
    description:
      'Who committed to do the thing. Use the owner identity block to resolve "I" and "me".',
  },
  {
    name: 'due',
    subject: ['commitment'],
    object: 'date',
    description: 'When the commitment is due.',
  },
  {
    name: 'done',
    subject: ['commitment'],
    object: 'date',
    description: 'The commitment was completed on this date. Only when the document says so.',
  },
  {
    name: 'depends_on',
    subject: ['project', 'milestone'],
    object: 'entity',
    objectEntity: ['project', 'milestone'],
    description: 'A dependency on another project or milestone.',
  },
  {
    name: 'affiliation',
    subject: ['person'],
    object: 'entity',
    objectEntity: ['organization'],
    description: 'The organization a person belongs to.',
  },
  {
    name: 'role',
    subject: ['person'],
    object: 'text',
    description: 'Job title or role as stated.',
  },
  {
    name: 'references',
    subject: WORK_ITEMS,
    object: 'entity',
    objectEntity: ['external'],
    description:
      'A ticket key, document, or URL referenced for this item. Name the external by its key or URL.',
  },
  {
    name: 'description',
    subject: ALL,
    object: 'text',
    description: 'A one-sentence description of the entity, close to how the document states it.',
  },
  {
    name: 'alias',
    subject: ALL,
    object: 'text',
    description: 'Another name the same entity is called by in this document.',
  },
];

const SPEC_BY_NAME = new Map(PREDICATE_SPECS.map((s) => [s.name, s]));

export function predicateSpec(name: Predicate): PredicateSpec {
  const spec = SPEC_BY_NAME.get(name);
  if (!spec) throw new Error(`unknown predicate ${name}`);
  return spec;
}

export const ENTITY_DESCRIPTIONS: Record<ExtractableEntityType, string> = {
  project:
    'A named body of work with an outcome, usually with an owner and a target. Includes initiatives, epics, programs, workstreams.',
  milestone:
    'A dated checkpoint inside a project: beta, launch, review, phase, release. Must belong to a project.',
  blocker:
    'Something that is stopping or slowing a project or milestone: a dependency, a risk that has materialized, a missing decision, a resource gap.',
  decision: 'A choice that was made, by whom, and when. Not a proposal or an open question.',
  commitment:
    'A promise by a specific person to do a specific thing, usually with a date: action items, TODOs, follow-ups, "I will".',
  person: 'A human named in the document.',
  organization: 'A company, customer, vendor, department or team named as an organization.',
  external:
    'A ticket key (ABC-123), a document title, or a URL that identifies something outside this document.',
};

/** Human-readable ontology block for prompts. */
export function renderOntology(): string {
  const lines: string[] = [];
  lines.push('Entity types:');
  for (const [type, desc] of Object.entries(ENTITY_DESCRIPTIONS)) {
    lines.push(`- ${type}: ${desc}`);
  }
  lines.push('');
  lines.push('Predicates (subject types -> object kind):');
  for (const s of PREDICATE_SPECS) {
    const obj = s.object === 'entity' ? `entity(${(s.objectEntity ?? []).join('|')})` : s.object;
    lines.push(`- ${s.name} [${s.subject.join('|')}] -> ${obj}: ${s.description}`);
  }
  return lines.join('\n');
}
