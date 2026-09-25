import type { DatePrecision, EntityType, ISODate, Predicate, ProjectStatus } from './types.ts';

/** Where an entry came from. The first provenance of an entry is its primary claim. */
export interface Provenance {
  claimId: string;
  sourceHash: string;
  validFrom: ISODate;
  recordedAt: ISODate;
  confidence: number;
  authority: number;
  /** Verbatim excerpt the claim rests on, shortened for display. */
  evidence: string;
  /** True when the claim was superseded by a re-extraction and no live claim replaced it. */
  superseded: boolean;
}

export interface StatusEntry {
  date: ISODate;
  status: ProjectStatus;
  claims: Provenance[];
  superseded: boolean;
  /** Set on the losing side of a same-day conflict (PRD FR4.6). */
  conflict?: boolean;
}

export interface DateEntry {
  date: ISODate;
  precision: DatePrecision;
  validTo?: ISODate;
  claims: Provenance[];
  superseded: boolean;
}

export interface TextEntry {
  text: string;
  claims: Provenance[];
  superseded: boolean;
}

export interface LinkEntry {
  predicate: Predicate;
  target: string;
  validTo?: ISODate;
  claims: Provenance[];
  superseded: boolean;
}

export type DateSlot = 'target' | 'resolved' | 'due' | 'done';
export type TextSlot = 'description' | 'team' | 'role' | 'decided';

export const ID_PREFIX: Record<EntityType, string> = {
  project: 'prj',
  milestone: 'mls',
  blocker: 'blk',
  decision: 'dec',
  commitment: 'cmt',
  person: 'per',
  organization: 'org',
  external: 'ext',
  source: 'src',
};

/**
 * A merged entity, rebuilt from the claim ledger on every compile and persisted under
 * .cubbon/entities/<type>/<id>.json. Dates are document dates; nothing here comes from the clock.
 */
export interface EntityRecord {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  /** Note filename without extension, fixed at first emit (ADR-003). */
  fileName: string;
  /** Earliest and latest document date among the claims that mention the entity. */
  firstSeen: ISODate;
  lastSeen: ISODate;
  /** Live source hashes that mention the entity. */
  sources: string[];
  /** Newest first. */
  statusLog: StatusEntry[];
  /** Per slot, in the order the dates were recorded. */
  dates: Partial<Record<DateSlot, DateEntry[]>>;
  texts: Partial<Record<TextSlot, TextEntry[]>>;
  links: LinkEntry[];
  questions: string[];
  /** No live claim mentions the entity any more. Marked, never deleted (PRD FR6.5). */
  retired: boolean;
  /** Block name -> hash of the last rendered block, used to detect edits inside markers. */
  renderHashes: Record<string, string>;
}

export interface RegistryEntry {
  type: EntityType;
  name: string;
  aliases: string[];
  fileName: string;
}
