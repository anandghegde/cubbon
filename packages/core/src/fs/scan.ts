import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_EXCLUDE_DIRS } from '../config/schema.ts';
import { isInside } from '../util/paths.ts';

export interface ScanOptions {
  folders: string[];
  extensions: string[];
  excludeDirs?: string[];
  /** Absolute paths never descended into (the vault itself, for instance). */
  excludePaths?: string[];
  maxFileBytes?: number;
  onError?: (p: string, err: unknown) => void;
}

export interface ScannedFile {
  path: string;
  mtimeMs: number;
  size: number;
}

/**
 * Recursively yields candidate files under the given folders in a deterministic order.
 * Symlinks are never followed. Excluded directory names are matched case-insensitively.
 */
export async function* scanFolders(opts: ScanOptions): AsyncGenerator<ScannedFile> {
  const excludeDirs = new Set(
    (opts.excludeDirs ?? DEFAULT_EXCLUDE_DIRS).map((d) => d.toLowerCase()),
  );
  const excludePaths = (opts.excludePaths ?? []).map((p) => path.resolve(p));
  const extensions = new Set(opts.extensions.map((e) => e.toLowerCase()));
  const maxBytes = opts.maxFileBytes ?? 2_000_000;
  const seen = new Set<string>();

  const folders = [...new Set(opts.folders.map((f) => path.resolve(f)))].sort();
  for (const root of folders) {
    // A folder nested inside another watched folder would be scanned twice; `seen` guards files.
    yield* walk(root);
  }

  async function* walk(dir: string): AsyncGenerator<ScannedFile> {
    if (excludePaths.some((ex) => isInside(ex, dir))) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      opts.onError?.(dir, err);
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name.toLowerCase())) continue;
        yield* walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!extensions.has(path.extname(entry.name).toLowerCase())) continue;
      if (seen.has(full)) continue;
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(full);
      } catch (err) {
        opts.onError?.(full, err);
        continue;
      }
      if (st.size > maxBytes) continue;
      seen.add(full);
      yield { path: full, mtimeMs: st.mtimeMs, size: st.size };
    }
  }
}
