import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface RawMeta {
  hash: string;
  /** Every path this content has been seen at. */
  paths: string[];
  firstSeen: string;
  lastSeen: string;
  mtimeMs: number;
  size: number;
}

/**
 * Content-addressed store of source documents as first seen (PRD FR1.4).
 * Layout: raw/<hh>/<hash>.md and raw/<hh>/<hash>.meta.json.
 */
export class RawStore {
  constructor(readonly root: string) {}

  pathFor(hash: string): string {
    return path.join(this.root, hash.slice(0, 2), `${hash}.md`);
  }

  metaPathFor(hash: string): string {
    return path.join(this.root, hash.slice(0, 2), `${hash}.meta.json`);
  }

  async getMeta(hash: string): Promise<RawMeta | null> {
    try {
      return JSON.parse(await readFile(this.metaPathFor(hash), 'utf8')) as RawMeta;
    } catch {
      return null;
    }
  }

  async get(hash: string): Promise<string | null> {
    try {
      return await readFile(this.pathFor(hash), 'utf8');
    } catch {
      return null;
    }
  }

  /** Stores content if new, and records the path in the metadata either way. */
  async put(
    hash: string,
    content: string,
    info: { path: string; mtimeMs: number; size: number; now: string },
  ): Promise<{ created: boolean; meta: RawMeta }> {
    const existing = await this.getMeta(hash);
    if (existing) {
      const paths = existing.paths.includes(info.path)
        ? existing.paths
        : [...existing.paths, info.path].sort();
      const meta: RawMeta = { ...existing, paths, lastSeen: info.now };
      await writeFile(this.metaPathFor(hash), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
      return { created: false, meta };
    }
    await mkdir(path.dirname(this.pathFor(hash)), { recursive: true });
    await writeFile(this.pathFor(hash), content, 'utf8');
    const meta: RawMeta = {
      hash,
      paths: [info.path],
      firstSeen: info.now,
      lastSeen: info.now,
      mtimeMs: info.mtimeMs,
      size: info.size,
    };
    await writeFile(this.metaPathFor(hash), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    return { created: true, meta };
  }
}
