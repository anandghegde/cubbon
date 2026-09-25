import { type EntityRecord, ID_PREFIX } from '../model/entities.ts';
import type { EntityType, ISODate, OwnerIdentity } from '../model/types.ts';
import { shortHash } from '../util/hash.ts';
import { externalKey, normalizeName, sanitizeFileName } from './normalize.ts';
import type { EntityRegistry } from './registry.ts';

export interface ResolveInput {
  type: EntityType;
  name: string;
}

/**
 * Resolution ladder (PRD FR4.2) without model assistance: user alias table, external key,
 * document-level aliases, normalized name, then a unique first-name match for people.
 * Unresolved references create a new entity with a deterministic id.
 */
export class Resolver {
  readonly entities = new Map<string, EntityRecord>();
  /** `${type}:${normalized name}` or external key -> entity id. */
  private readonly index = new Map<string, string>();
  /** `${type}:${normalized alias}` -> `${type}:${normalized canonical}` (from extraction metadata). */
  private readonly docAliases = new Map<string, string>();
  /** Creation order, which fixes filename allocation order. */
  readonly created: string[] = [];

  constructor(
    private readonly registry: EntityRegistry,
    private readonly owner: OwnerIdentity,
  ) {
    for (const [id, e] of Object.entries(registry.entries)) {
      if (e.type === 'source') continue;
      this.indexName(e.type, e.name, id);
      for (const a of e.aliases) this.indexName(e.type, a, id);
    }
  }

  private indexName(type: EntityType, name: string, id: string): void {
    const key = externalKey(name);
    if (key && !this.index.has(key)) this.index.set(key, id);
    const norm = normalizeName(name);
    if (norm && !this.index.has(`${type}:${norm}`)) this.index.set(`${type}:${norm}`, id);
  }

  /** Aliases proposed by the extractor for one document: trusted within that document's claims. */
  addDocAlias(type: EntityType, alias: string, canonical: string): void {
    const a = normalizeName(alias);
    const c = normalizeName(canonical);
    if (!a || !c || a === c) return;
    this.docAliases.set(`${type}:${a}`, `${type}:${c}`);
  }

  private lookup(type: EntityType, name: string): string | null {
    const norm = normalizeName(name);
    if (!norm) return null;
    const user = this.registry.userAliases[type]?.[norm] ?? this.registry.userAliases[type]?.[name];
    if (user) {
      if (this.entities.has(user) || this.registry.get(user)) return user;
      const viaName = this.index.get(`${type}:${normalizeName(user)}`);
      if (viaName) return viaName;
    }
    const key = externalKey(name);
    if (key) {
      const hit = this.index.get(key);
      if (hit) return hit;
    }
    const direct = this.index.get(`${type}:${norm}`);
    if (direct) return direct;
    const viaDoc = this.docAliases.get(`${type}:${norm}`);
    if (viaDoc) {
      const hit = this.index.get(viaDoc);
      if (hit) return hit;
    }
    if (type === 'person') {
      if (this.isOwner(name)) {
        const ownerHit = this.index.get(`person:${normalizeName(this.owner.name)}`);
        if (ownerHit) return ownerHit;
      }
      return this.uniqueFirstName(norm) ?? this.bareFirstName(norm);
    }
    return null;
  }

  /** "Marcus Chen" arriving after a bare "Marcus": adopt the bare entity so it can be upgraded. */
  private bareFirstName(norm: string): string | null {
    const first = norm.split(' ')[0] ?? '';
    if (!first || first === norm) return null;
    const id = this.index.get(`person:${first}`);
    if (!id) return null;
    const e = this.entities.get(id);
    const canonical = e ? normalizeName(e.name) : normalizeName(this.registry.get(id)?.name ?? '');
    return canonical === first ? id : null;
  }

  private isOwner(name: string): boolean {
    const norm = normalizeName(name);
    if (norm === normalizeName(this.owner.name)) return true;
    if (this.owner.email && norm === this.owner.email.toLowerCase()) return true;
    return this.owner.aliases.some((a) => normalizeName(a) === norm);
  }

  private uniqueFirstName(norm: string): string | null {
    if (norm.includes(' ') || norm.length < 2) return null;
    const hits = new Set<string>();
    for (const [key, id] of this.index) {
      if (!key.startsWith('person:')) continue;
      const full = key.slice('person:'.length);
      if (full === norm || full.startsWith(`${norm} `)) hits.add(id);
    }
    return hits.size === 1 ? ([...hits][0] ?? null) : null;
  }

  /** Returns the entity for a reference, creating it when nothing matches. */
  resolve(ref: ResolveInput, seen: ISODate): EntityRecord {
    let name = ref.name.trim();
    if (ref.type === 'person' && this.isOwner(name)) name = this.owner.name;
    const id = this.lookup(ref.type, name) ?? this.create(ref.type, name);
    const entity = this.materialize(id, ref.type, name);
    this.maybeUpgradeName(entity, name);
    if (seen < entity.firstSeen) entity.firstSeen = seen;
    if (seen > entity.lastSeen) entity.lastSeen = seen;
    return entity;
  }

  private create(type: EntityType, name: string): string {
    const id = `${ID_PREFIX[type]}_${shortHash(`${type}|${normalizeName(name)}`, 8)}`;
    this.indexName(type, name, id);
    return id;
  }

  private materialize(id: string, type: EntityType, name: string): EntityRecord {
    const existing = this.entities.get(id);
    if (existing) return existing;
    const reg = this.registry.get(id);
    const entity: EntityRecord = {
      id,
      type: reg?.type ?? type,
      name: reg?.name ?? name,
      aliases: reg ? [...reg.aliases] : [],
      fileName: reg?.fileName ?? '',
      firstSeen: '9999-12-31',
      lastSeen: '0000-01-01',
      sources: [],
      statusLog: [],
      dates: {},
      texts: {},
      links: [],
      questions: [],
      retired: false,
      renderHashes: {},
    };
    this.entities.set(id, entity);
    this.created.push(id);
    return entity;
  }

  /** "Priya" seen first, "Priya Nair" later: the fuller name becomes canonical, the short one an alias. */
  private maybeUpgradeName(entity: EntityRecord, name: string): void {
    const norm = normalizeName(name);
    const current = normalizeName(entity.name);
    if (norm === current) return;
    const fuller =
      norm.split(' ').length > current.split(' ').length && norm.startsWith(`${current} `);
    if (fuller) {
      const short = entity.name;
      entity.name = name;
      this.indexName(entity.type, name, entity.id);
      this.addAlias(entity, short);
    } else {
      this.addAlias(entity, name);
    }
  }

  addAlias(entity: EntityRecord, alias: string): void {
    const norm = normalizeName(alias);
    if (!norm || norm === normalizeName(entity.name)) return;
    if (entity.aliases.some((a) => normalizeName(a) === norm)) return;
    entity.aliases.push(alias);
    entity.aliases.sort((a, b) => a.localeCompare(b));
    this.indexName(entity.type, alias, entity.id);
  }

  /** Fix names and filenames in the registry after the merge pass. */
  commit(): void {
    for (const id of this.created) {
      const e = this.entities.get(id) as EntityRecord;
      const preferred = sanitizeFileName(this.preferredFileName(e));
      const entry = this.registry.register(id, e.type, e.name, preferred);
      this.registry.rename(id, e.name);
      for (const a of e.aliases) this.registry.addAlias(id, a);
      e.fileName = entry.fileName;
      e.aliases = [...entry.aliases];
      if (e.aliases.includes(e.name)) e.aliases = e.aliases.filter((a) => a !== e.name);
    }
  }

  private preferredFileName(e: EntityRecord): string {
    if (e.type === 'milestone') {
      const parent = e.links.find((l) => l.predicate === 'part_of' && !l.superseded);
      const project = parent ? this.entities.get(parent.target) : undefined;
      if (project && project.type === 'project') return `${project.name} – ${e.name}`;
    }
    return e.name;
  }
}
