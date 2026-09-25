import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { RegistryEntry } from '../model/entities.ts';
import type { EntityType } from '../model/types.ts';
import { normalizeName } from './normalize.ts';

export interface RegistryFile {
  version: 1;
  entities: Record<string, RegistryEntry>;
}

export type UserAliases = Partial<Record<EntityType, Record<string, string>>>;

const ALIAS_HEADER = `# Cubbon alias table. Maps a surface form to the canonical name (or cubbon id) of an entity,
# per entity type. Confirmed merges from review.md are added here; edit freely.
`;

/**
 * Persistent identity: ids, canonical names, aliases and fixed filenames for every entity ever
 * emitted (ADR-003). Lives at .cubbon/entities/registry.json next to the entity records.
 */
export class EntityRegistry {
  readonly entries: Record<string, RegistryEntry>;
  private readonly usedFileNames = new Set<string>();

  constructor(
    readonly dir: string,
    file: RegistryFile | null,
    readonly userAliases: UserAliases,
  ) {
    this.entries = file?.entities ?? {};
    for (const e of Object.values(this.entries)) this.usedFileNames.add(e.fileName.toLowerCase());
  }

  static async load(dir: string): Promise<EntityRegistry> {
    let file: RegistryFile | null = null;
    try {
      file = JSON.parse(await readFile(path.join(dir, 'registry.json'), 'utf8')) as RegistryFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    let aliases: UserAliases = {};
    try {
      const parsed = YAML.parse(
        await readFile(path.join(path.dirname(dir), 'aliases.yaml'), 'utf8'),
      );
      if (parsed && typeof parsed === 'object') aliases = parsed as UserAliases;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return new EntityRegistry(dir, file, aliases);
  }

  static async writeDefaultAliases(cubbonDir: string): Promise<void> {
    const file = path.join(cubbonDir, 'aliases.yaml');
    try {
      await writeFile(
        file,
        `${ALIAS_HEADER}project: {}\nperson: {}\norganization: {}\nexternal: {}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }

  get(id: string): RegistryEntry | undefined {
    return this.entries[id];
  }

  /** Records a new entity and allocates a vault-unique filename. */
  register(id: string, type: EntityType, name: string, preferredFileName: string): RegistryEntry {
    const existing = this.entries[id];
    if (existing) return existing;
    const fileName = this.allocateFileName(preferredFileName);
    const entry: RegistryEntry = { type, name, aliases: [], fileName };
    this.entries[id] = entry;
    return entry;
  }

  /** The canonical name may improve over time; the filename never changes (ADR-003). */
  rename(id: string, name: string): void {
    const e = this.entries[id];
    if (!e || e.name === name) return;
    if (!e.aliases.includes(e.name) && normalizeName(e.name) !== normalizeName(name)) {
      e.aliases.push(e.name);
    }
    e.name = name;
  }

  addAlias(id: string, alias: string): void {
    const e = this.entries[id];
    if (!e) return;
    const norm = normalizeName(alias);
    if (!norm || norm === normalizeName(e.name)) return;
    if (e.aliases.some((a) => normalizeName(a) === norm)) return;
    e.aliases.push(alias);
    e.aliases.sort((a, b) => a.localeCompare(b));
  }

  private allocateFileName(preferred: string): string {
    let candidate = preferred;
    let n = 2;
    while (this.usedFileNames.has(candidate.toLowerCase())) {
      candidate = `${preferred} (${n})`;
      n += 1;
    }
    this.usedFileNames.add(candidate.toLowerCase());
    return candidate;
  }

  async save(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const ids = Object.keys(this.entries).sort();
    const entities: Record<string, RegistryEntry> = {};
    for (const id of ids) entities[id] = this.entries[id] as RegistryEntry;
    const file: RegistryFile = { version: 1, entities };
    await writeFile(path.join(this.dir, 'registry.json'), `${JSON.stringify(file, null, 2)}\n`);
  }
}
