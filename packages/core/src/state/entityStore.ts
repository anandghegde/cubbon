import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EntityRecord } from '../model/entities.ts';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Entity records under .cubbon/entities/<type>/<id>.json, written only when they change. */
export class EntityStore {
  constructor(readonly root: string) {}

  fileFor(type: string, id: string): string {
    return path.join(this.root, type, `${id}.json`);
  }

  async read(type: string, id: string): Promise<EntityRecord | null> {
    try {
      return JSON.parse(await readFile(this.fileFor(type, id), 'utf8')) as EntityRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Render hashes of generated notes that are not entities (the hub). */
  async readHashes(name: string): Promise<Record<string, string> | undefined> {
    try {
      return JSON.parse(
        await readFile(path.join(this.root, '_notes', `${name}.json`), 'utf8'),
      ) as Record<string, string>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async writeHashes(name: string, hashes: Record<string, string>): Promise<boolean> {
    return this.writeJson(path.join(this.root, '_notes', `${name}.json`), hashes);
  }

  async write(e: EntityRecord): Promise<boolean> {
    return this.writeJson(this.fileFor(e.type, e.id), e);
  }

  private async writeJson(file: string, value: unknown): Promise<boolean> {
    const next = `${JSON.stringify(sortKeys(value), null, 2)}\n`;
    try {
      if ((await readFile(file, 'utf8')) === next) return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, next, 'utf8');
    return true;
  }
}
