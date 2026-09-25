import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RawStore } from '../src/fs/rawStore.ts';
import { scanFolders } from '../src/fs/scan.ts';
import { sha256Hex } from '../src/util/hash.ts';
import { tempDir } from './helpers.ts';

let root: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ dir: root, cleanup } = await tempDir());
  await mkdir(path.join(root, 'docs', 'sub'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'node_modules', 'pkg'), { recursive: true });
  await mkdir(path.join(root, 'vault'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'b.md'), '# b');
  await writeFile(path.join(root, 'docs', 'a.md'), '# a');
  await writeFile(path.join(root, 'docs', 'sub', 'c.MD'), '# c');
  await writeFile(path.join(root, 'docs', 'sub', 'd.txt'), 'text');
  await writeFile(path.join(root, 'docs', 'node_modules', 'pkg', 'README.md'), '# skip');
  await writeFile(path.join(root, 'docs', 'big.md'), 'x'.repeat(5000));
  await writeFile(path.join(root, 'vault', 'index.md'), '# vault');
  await symlink(path.join(root, 'vault'), path.join(root, 'docs', 'link'));
});
afterAll(() => cleanup());

describe('scanFolders', () => {
  test('deterministic order, exclusions, extensions, size, symlinks', async () => {
    const files: string[] = [];
    for await (const f of scanFolders({
      folders: [path.join(root, 'docs'), root],
      extensions: ['.md'],
      excludePaths: [path.join(root, 'vault')],
      maxFileBytes: 4000,
    })) {
      files.push(path.relative(root, f.path));
    }
    expect(files).toEqual(['docs/a.md', 'docs/b.md', 'docs/sub/c.MD']);
  });
});

describe('RawStore', () => {
  test('content addressed with merged path metadata', async () => {
    const store = new RawStore(path.join(root, 'raw'));
    const content = '# hello';
    const hash = sha256Hex(content);
    const first = await store.put(hash, content, {
      path: '/p/one.md',
      mtimeMs: 1,
      size: 7,
      now: '2026-09-25T00:00:00Z',
    });
    expect(first.created).toBe(true);
    const second = await store.put(hash, content, {
      path: '/p/two.md',
      mtimeMs: 2,
      size: 7,
      now: '2026-09-26T00:00:00Z',
    });
    expect(second.created).toBe(false);
    expect(second.meta.paths).toEqual(['/p/one.md', '/p/two.md']);
    expect(second.meta.firstSeen).toBe('2026-09-25T00:00:00Z');
    expect(await store.get(hash)).toBe(content);
    expect(await store.get('nope')).toBeNull();
  });
});
