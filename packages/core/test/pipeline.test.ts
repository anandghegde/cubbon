import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFile, mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadVaultConfig } from '../src/config/load.ts';
import { compile } from '../src/pipeline/compile.ts';
import { createContext, type PipelineContext } from '../src/pipeline/context.ts';
import { initVault } from '../src/pipeline/init.ts';
import { FIXTURE_DOC, sprintProvider, tempDir } from './helpers.ts';

let root: string;
let cleanup: () => Promise<void>;
let vault: string;
let docs: string;
let ctx: PipelineContext;
let tick = 0;
const now = () => new Date(Date.UTC(2026, 8, 25, 12, 0, tick++));

beforeAll(async () => {
  ({ dir: root, cleanup } = await tempDir());
  vault = path.join(root, 'vault');
  docs = path.join(root, 'docs');
  await mkdir(docs, { recursive: true });
  await copyFile(FIXTURE_DOC, path.join(docs, 'sprint-2026-09-20.md'));
  await writeFile(
    path.join(docs, 'recipe.md'),
    `# Pancakes\n\nMix flour and eggs. ${'Cook well. '.repeat(20)}`,
  );
  await writeFile(path.join(docs, 'tiny.md'), 'x');
  await initVault(vault, {
    folders: [docs],
    owner: { name: 'Anand Hegde', email: 'a@example.com' },
  });
  const config = await loadVaultConfig(vault);
  ctx = createContext(vault, config, { provider: sprintProvider(), now });
});
afterAll(async () => {
  ctx.close();
  await cleanup();
});

describe('init', () => {
  test('creates layout and config', async () => {
    const entries = await readdir(vault);
    expect(entries).toEqual(
      expect.arrayContaining([
        '.cubbon',
        '.obsidian',
        'raw',
        'wiki',
        'days',
        'bases',
        'log',
        'index.md',
      ]),
    );
    const config = await loadVaultConfig(vault);
    expect(config.watch.folders).toEqual([docs]);
    expect(config.watch.excludePaths).toEqual([vault]);
    expect(config.owner.email).toBe('a@example.com');
    expect(ctx.extractorVersion).toHaveLength(8);
  });
});

describe('compile', () => {
  test('first run extracts, ignores and logs', async () => {
    const s = await compile(ctx, { extract: true });
    expect(s).toMatchObject({
      scanned: 3,
      extracted: 1,
      ignored: 2,
      unchanged: 0,
      errors: 0,
      claims: 12,
    });
    const sprint = s.outcomes.find((o) => o.path.endsWith('sprint-2026-09-20.md'));
    expect(sprint).toMatchObject({
      status: 'extracted',
      sourceType: 'document',
      chunks: 1,
      dropped: 1,
    });
    const hash = sprint?.hash as string;
    expect(await ctx.raw.get(hash)).toBe(await readFile(FIXTURE_DOC, 'utf8'));
    expect((await ctx.claims.read(hash)).length).toBe(12);
    expect((await ctx.claims.readMeta(hash))?.entities.length).toBe(4);
    expect(ctx.db.countClaims({ live: true })).toBe(12);
    expect(ctx.db.getSource(sprint?.path as string)).toMatchObject({
      triage: 'work',
      claimCount: 12,
      extractorVersion: ctx.extractorVersion,
    });
    const log = await readFile(path.join(vault, 'log', '2026-09-25.md'), 'utf8');
    expect(log).toContain('extracted 1');
    expect(log).toContain('12 claims from 1 chunk, 1 dropped');
    expect(ctx.db.lastRuns()[0]?.status).toBe('ok');
  });

  test('second run is a no-op', async () => {
    const s = await compile(ctx, { extract: true });
    expect(s).toMatchObject({ scanned: 3, unchanged: 3, extracted: 0, claims: 0 });
    expect(ctx.db.countClaims()).toBe(12);
  });

  test('touching a file without changing content does not re-extract', async () => {
    const file = path.join(docs, 'sprint-2026-09-20.md');
    await utimes(file, new Date(), new Date(Date.now() + 5000));
    const s = await compile(ctx, { extract: true });
    expect(s).toMatchObject({ unchanged: 3, extracted: 0 });
  });

  test('changed content re-extracts and supersedes the old hash', async () => {
    const file = path.join(docs, 'sprint-2026-09-20.md');
    const before = ctx.db.getSource(file)?.hash as string;
    await writeFile(file, `${await readFile(file, 'utf8')}\n\nAppended note.\n`);
    const s = await compile(ctx, { extract: true });
    expect(s).toMatchObject({ extracted: 1, unchanged: 2, claims: 12 });
    const after = ctx.db.getSource(file)?.hash as string;
    expect(after).not.toBe(before);
    expect(ctx.db.countClaims()).toBe(24);
    expect(ctx.db.countClaims({ live: true })).toBe(12);
    expect((await ctx.claims.read(before)).every((c) => c.supersededAt)).toBe(true);
    expect((await ctx.raw.get(before))?.length).toBeGreaterThan(0);
  });

  test('extraction off stores and triages only', async () => {
    await writeFile(
      path.join(docs, 'roadmap.md'),
      `# Roadmap\n\nProject Alpha, owner Kim, milestone launch 2026-12-01, status on track.\n\n${'The sprint goal is unchanged and the team is on track. '.repeat(6)}\n`,
    );
    const s = await compile(ctx, { extract: false });
    expect(s.outcomes.find((o) => o.path.endsWith('roadmap.md'))).toMatchObject({
      status: 'stored',
      triage: 'work',
    });
    const again = await compile(ctx, { extract: true });
    expect(again.outcomes.find((o) => o.path.endsWith('roadmap.md'))).toMatchObject({
      status: 'extracted',
      claims: 0,
    });
  });

  test('a provider failure is reported per file, not thrown', async () => {
    const failing = createContext(vault, await loadVaultConfig(vault), {
      provider: {
        name: 'boom',
        model: 'boom',
        complete: async () => {
          throw new Error('kaboom');
        },
      },
      now,
    });
    try {
      const s = await compile(failing, { extract: true, force: true });
      expect(s.errors).toBe(2);
      expect(s.outcomes.find((o) => o.status === 'error')?.error).toBe('kaboom');
      expect(s.ignored).toBe(2);
    } finally {
      failing.close();
    }
  });
});
