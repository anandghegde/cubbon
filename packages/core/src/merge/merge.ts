import type { ExtractedEntity } from '../extract/schema.ts';
import type {
  DateEntry,
  DateSlot,
  EntityRecord,
  LinkEntry,
  Provenance,
  StatusEntry,
  TextEntry,
  TextSlot,
} from '../model/entities.ts';
import type { Claim, OwnerIdentity } from '../model/types.ts';
import { normalizeName } from './normalize.ts';
import type { EntityRegistry } from './registry.ts';
import { Resolver } from './resolve.ts';

export interface MergeInput {
  claims: Claim[];
  /** Extractor-proposed entities and aliases per live source hash. */
  metaEntities: Record<string, ExtractedEntity[]>;
  registry: EntityRegistry;
  owner: OwnerIdentity;
}

export interface MergeResult {
  entities: Map<string, EntityRecord>;
  /** Claim id -> entity id of its subject, and of its object when the object is an entity. */
  claimSubjects: Map<string, string>;
  claimObjects: Map<string, string>;
  /** Latest document date in the ledger; "today" for anything that needs a reference date. */
  asOf: string;
  stats: { claims: number; live: number; entities: number; questions: number };
}

const DATE_SLOT: Partial<Record<Claim['predicate'], DateSlot>> = {
  target_date: 'target',
  resolved: 'resolved',
  due: 'due',
  done: 'done',
};
const TEXT_SLOT: Partial<Record<Claim['predicate'], TextSlot>> = {
  description: 'description',
  team: 'team',
  role: 'role',
  decided: 'decided',
};
const CONFLICT_WINDOW_DAYS = 7;

function provenance(c: Claim): Provenance {
  return {
    claimId: c.id,
    sourceHash: c.sourceHash,
    validFrom: c.validFrom,
    recordedAt: c.recordedAt,
    confidence: c.confidence,
    authority: c.authority,
    evidence: c.evidence.length > 160 ? `${c.evidence.slice(0, 157).trimEnd()}...` : c.evidence,
    superseded: c.supersededAt !== undefined,
  };
}

/** Higher authority first, then later document date, then claim id for stability. */
function byStrength(a: Provenance, b: Provenance): number {
  if (a.superseded !== b.superseded) return a.superseded ? 1 : -1;
  if (a.authority !== b.authority) return b.authority - a.authority;
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? 1 : -1;
  return a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0;
}

function addProvenance(entry: { claims: Provenance[]; superseded: boolean }, p: Provenance): void {
  if (entry.claims.some((x) => x.claimId === p.claimId)) return;
  entry.claims.push(p);
  entry.claims.sort(byStrength);
  entry.superseded = entry.claims.every((x) => x.superseded);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

function claimOrder(a: Claim, b: Claim): number {
  const al = a.supersededAt === undefined ? 0 : 1;
  const bl = b.supersededAt === undefined ? 0 : 1;
  if (al !== bl) return al - bl;
  if (a.validFrom !== b.validFrom) return a.validFrom < b.validFrom ? -1 : 1;
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
  if (a.sourceHash !== b.sourceHash) return a.sourceHash < b.sourceHash ? -1 : 1;
  if (a.span.start !== b.span.start) return a.span.start - b.span.start;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Rebuilds every entity from the full claim ledger (ADR-002). Deterministic: the same ledger and
 * registry always produce the same records. Idempotent by construction (PRD FR4.8).
 */
export function mergeLedger(input: MergeInput): MergeResult {
  const resolver = new Resolver(input.registry, input.owner);
  for (const hash of Object.keys(input.metaEntities).sort()) {
    for (const e of input.metaEntities[hash] ?? []) {
      for (const alias of e.aliases) resolver.addDocAlias(e.type, alias, e.name);
    }
  }

  const claims = [...input.claims].sort(claimOrder);
  const claimSubjects = new Map<string, string>();
  const claimObjects = new Map<string, string>();
  let asOf = '0000-01-01';
  const touched = new Map<string, { live: boolean }>();
  const touch = (e: EntityRecord, c: Claim): void => {
    const live = c.supersededAt === undefined;
    if (live && !e.sources.includes(c.sourceHash)) e.sources.push(c.sourceHash);
    const t = touched.get(e.id) ?? { live: false };
    t.live = t.live || live;
    touched.set(e.id, t);
  };

  for (const c of claims) {
    if (c.supersededAt === undefined && c.recordedAt > asOf) asOf = c.recordedAt;
    const subject = resolver.resolve(c.subject, c.recordedAt);
    touch(subject, c);
    claimSubjects.set(c.id, subject.id);
    const p = provenance(c);

    if (c.predicate === 'alias' && c.object.kind === 'text') {
      resolver.addAlias(subject, c.object.value);
      continue;
    }
    if (c.object.kind === 'status') {
      applyStatus(subject, c.validFrom, c.object.value, p);
      continue;
    }
    if (c.object.kind === 'date') {
      const slot = DATE_SLOT[c.predicate];
      if (!slot) continue;
      applyDate(
        subject,
        slot,
        { date: c.object.value, precision: c.object.precision ?? 'day', validTo: c.validTo },
        p,
      );
      continue;
    }
    if (c.object.kind === 'text') {
      const slot = TEXT_SLOT[c.predicate];
      if (!slot) continue;
      applyText(subject, slot, c.object.value, p);
      continue;
    }
    const target = resolver.resolve({ type: c.object.type, name: c.object.name }, c.recordedAt);
    touch(target, c);
    claimObjects.set(c.id, target.id);
    if (target.id === subject.id) continue;
    applyLink(subject, c.predicate, target.id, c.validTo, p);
  }

  for (const [id, t] of touched) {
    const e = resolver.entities.get(id) as EntityRecord;
    e.retired = !t.live;
  }
  for (const e of resolver.entities.values()) finalize(e);
  resolver.commit();

  const entities = new Map([...resolver.entities.entries()].sort(([a], [b]) => a.localeCompare(b)));
  let questions = 0;
  for (const e of entities.values()) questions += e.questions.length;
  return {
    entities,
    claimSubjects,
    claimObjects,
    asOf: asOf === '0000-01-01' ? '' : asOf,
    stats: {
      claims: claims.length,
      live: claims.filter((c) => c.supersededAt === undefined).length,
      entities: entities.size,
      questions,
    },
  };
}

/** PRD FR4.4 status log append with corroboration, FR4.6 conflict rule for the same day. */
function applyStatus(
  e: EntityRecord,
  date: string,
  status: StatusEntry['status'],
  p: Provenance,
): void {
  const same = e.statusLog.find((s) => s.date === date && s.status === status);
  if (same) {
    addProvenance(same, p);
    return;
  }
  const entry: StatusEntry = { date, status, claims: [p], superseded: p.superseded };
  e.statusLog.push(entry);
}

function applyDate(
  e: EntityRecord,
  slot: DateSlot,
  d: Omit<DateEntry, 'claims' | 'superseded'>,
  p: Provenance,
): void {
  let list = e.dates[slot];
  if (!list) {
    list = [];
    e.dates[slot] = list;
  }
  const same = list.find((x) => x.date === d.date && x.precision === d.precision);
  if (same) {
    addProvenance(same, p);
    if (d.validTo && (!same.validTo || d.validTo < same.validTo)) same.validTo = d.validTo;
    return;
  }
  const entry: DateEntry = {
    date: d.date,
    precision: d.precision,
    claims: [p],
    superseded: p.superseded,
  };
  if (d.validTo) entry.validTo = d.validTo;
  list.push(entry);
}

function applyText(e: EntityRecord, slot: TextSlot, text: string, p: Provenance): void {
  let list = e.texts[slot];
  if (!list) {
    list = [];
    e.texts[slot] = list;
  }
  const norm = normalizeName(text);
  const same = list.find((x) => normalizeName(x.text) === norm);
  if (same) {
    addProvenance(same, p);
    return;
  }
  const entry: TextEntry = { text: text.trim(), claims: [p], superseded: p.superseded };
  list.push(entry);
}

function applyLink(
  e: EntityRecord,
  predicate: LinkEntry['predicate'],
  target: string,
  validTo: string | undefined,
  p: Provenance,
): void {
  const same = e.links.find((l) => l.predicate === predicate && l.target === target);
  if (same) {
    addProvenance(same, p);
    if (validTo && (!same.validTo || validTo < same.validTo)) same.validTo = validTo;
    return;
  }
  const entry: LinkEntry = { predicate, target, claims: [p], superseded: p.superseded };
  if (validTo) entry.validTo = validTo;
  e.links.push(entry);
}

/** Sort entries, mark same-day status conflicts, raise open questions (FR4.6). */
function finalize(e: EntityRecord): void {
  e.sources.sort();
  e.statusLog.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return byStrength(a.claims[0] as Provenance, b.claims[0] as Provenance);
  });
  const byDay = new Map<string, StatusEntry[]>();
  for (const s of e.statusLog) {
    if (s.superseded) continue;
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }
  for (const [day, entries] of byDay) {
    if (entries.length < 2) continue;
    const [winner, ...losers] = entries;
    for (const l of losers) l.conflict = true;
    const w = (winner as StatusEntry).claims[0] as Provenance;
    for (const l of losers) {
      const lp = l.claims[0] as Provenance;
      if (
        lp.authority === w.authority &&
        daysBetween(lp.recordedAt, w.recordedAt) <= CONFLICT_WINDOW_DAYS
      ) {
        e.questions.push(
          `Status on ${day}: sources disagree (${(winner as StatusEntry).status} vs ${l.status}) with equal authority. Kept ${(winner as StatusEntry).status}.`,
        );
      }
    }
  }
  for (const slot of Object.keys(e.dates) as DateSlot[]) {
    (e.dates[slot] as DateEntry[]).sort((a, b) => {
      const ar = a.claims[0] as Provenance;
      const br = b.claims[0] as Provenance;
      if (ar.recordedAt !== br.recordedAt) return ar.recordedAt < br.recordedAt ? -1 : 1;
      if ((a.validTo ?? '') !== (b.validTo ?? '')) return a.validTo ? -1 : 1;
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
  }
  for (const slot of Object.keys(e.texts) as TextSlot[]) {
    (e.texts[slot] as TextEntry[]).sort((a, b) =>
      byStrength(a.claims[0] as Provenance, b.claims[0] as Provenance),
    );
  }
  e.links.sort(
    (a, b) => a.predicate.localeCompare(b.predicate) || a.target.localeCompare(b.target),
  );
  e.questions = [...new Set(e.questions)].sort();
}

/** The status that holds now: newest live entry, conflicts already resolved by order. */
export function currentStatus(e: EntityRecord): StatusEntry | undefined {
  return e.statusLog.find((s) => !s.superseded && !s.conflict) ?? e.statusLog[0];
}

/** The date that holds now for a slot: latest recorded, open-ended entries first. */
export function currentDate(e: EntityRecord, slot: DateSlot): DateEntry | undefined {
  const list = (e.dates[slot] ?? []).filter((d) => !d.superseded);
  const open = list.filter((d) => !d.validTo);
  const pool = open.length ? open : list;
  return pool[pool.length - 1];
}

export function liveLinks(e: EntityRecord, predicate?: LinkEntry['predicate']): LinkEntry[] {
  return e.links.filter((l) => !l.superseded && (!predicate || l.predicate === predicate));
}

export function bestText(e: EntityRecord, slot: TextSlot): TextEntry | undefined {
  return (e.texts[slot] ?? []).find((t) => !t.superseded) ?? e.texts[slot]?.[0];
}
