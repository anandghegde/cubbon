/**
 * Domain types shared across the pipeline. See PRD FR2 and IMPLEMENTATION_PLAN 3.1.
 */

export const EXTRACTABLE_ENTITY_TYPES = [
  'project',
  'milestone',
  'blocker',
  'decision',
  'commitment',
  'person',
  'organization',
  'external',
] as const;
/** Entity types the extractor may emit. `source` is created by the pipeline, never by the model. */
export type ExtractableEntityType = (typeof EXTRACTABLE_ENTITY_TYPES)[number];

export const ENTITY_TYPES = [...EXTRACTABLE_ENTITY_TYPES, 'source'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PROJECT_STATUSES = [
  'planned',
  'on-track',
  'at-risk',
  'blocked',
  'on-hold',
  'done',
  'cancelled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const SOURCE_TYPES = ['document', 'email', 'chat', 'ticket', 'meeting', 'unknown'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const PREDICATES = [
  'status',
  'target_date',
  'owner',
  'team',
  'member',
  'part_of',
  'blocks',
  'resolved',
  'decided',
  'assignee',
  'due',
  'done',
  'depends_on',
  'affiliation',
  'role',
  'references',
  'description',
  'alias',
] as const;
export type Predicate = (typeof PREDICATES)[number];

/** ISO calendar date, YYYY-MM-DD. */
export type ISODate = string;
/** ISO 8601 date-time with timezone. */
export type ISODateTime = string;

export type DatePrecision = 'day' | 'month' | 'quarter' | 'year';

export interface EntityRef {
  type: ExtractableEntityType;
  /** Surface form as written in the source. */
  name: string;
  /** Resolved entity id, set by merge. */
  id?: string;
}

export type ClaimObject =
  | { kind: 'status'; value: ProjectStatus }
  | { kind: 'date'; value: ISODate; precision?: DatePrecision }
  | { kind: 'text'; value: string }
  | { kind: 'entity'; type: ExtractableEntityType; name: string; id?: string };

export interface Span {
  /** Character offsets into the source document body (after frontmatter). */
  start: number;
  end: number;
  /** False when the evidence quote could only be located approximately. */
  exact: boolean;
}

export interface Claim {
  /** clm_ + 16 hex chars, deterministic. See extract/ids.ts. */
  id: string;
  subject: EntityRef;
  predicate: Predicate;
  object: ClaimObject;
  /** Valid time: when the fact became true. Defaults to the document date. */
  validFrom: ISODate;
  validTo?: ISODate;
  /** Recorded time: the document date. */
  recordedAt: ISODate;
  /** Ingested time: when Cubbon processed the source. */
  ingestedAt: ISODateTime;
  sourceHash: string;
  sourcePath: string;
  span: Span;
  /** Verbatim evidence excerpt as returned by the extractor. */
  evidence: string;
  /** Extractor confidence, 0..1. */
  confidence: number;
  /** Source authority weight, 0..1, assigned from the source type. */
  authority: number;
  extractorVersion: string;
  model: string;
  /** Set when a later extraction of the same path no longer produced this claim. */
  supersededAt?: ISODateTime;
}

export interface OwnerIdentity {
  name: string;
  email?: string;
  aliases: string[];
  organization?: string;
}

export interface DocDate {
  date: ISODate;
  method: 'frontmatter' | 'filename' | 'title' | 'body' | 'mtime';
  confidence: number;
}
