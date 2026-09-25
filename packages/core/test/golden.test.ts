import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadVaultConfig } from '../src/config/load.ts';
import { type CompileSummary, compile } from '../src/pipeline/compile.ts';
import { createContext } from '../src/pipeline/context.ts';
import { initVault } from '../src/pipeline/init.ts';
import { FIXTURE_DOC, sprintProvider, tempDir } from './helpers.ts';

let root: string;
let cleanup: () => Promise<void>;
let docs: string;

const GENERATED = ['wiki', 'days', 'bases', 'index.md', '.cubbon/entities'];

async function walk(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await readdir(dir)).sort()) {
    const full = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full, r)));
    else out.push(r);
  }
  return out;
}

async function snapshot(vault: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const top of GENERATED) {
    const full = path.join(vault, top);
    try {
      if ((await stat(full)).isDirectory()) {
        for (const rel of await walk(full, top))
          files[rel] = await readFile(path.join(vault, rel), 'utf8');
      } else files[top] = await readFile(full, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return files;
}

async function compileFresh(
  vault: string,
): Promise<{ first: CompileSummary; second: CompileSummary }> {
  await initVault(vault, {
    folders: [docs],
    owner: { name: 'Anand Hegde', email: 'a@example.com' },
  });
  const config = await loadVaultConfig(vault);
  let tick = 0;
  const ctx = createContext(vault, config, {
    provider: sprintProvider(),
    now: () => new Date(Date.UTC(2026, 8, 25, 12, 0, tick++)),
  });
  try {
    const first = await compile(ctx, { extract: true });
    const second = await compile(ctx, { extract: true });
    return { first, second };
  } finally {
    ctx.close();
  }
}

beforeAll(async () => {
  ({ dir: root, cleanup } = await tempDir());
  docs = path.join(root, 'docs');
  await mkdir(docs, { recursive: true });
  await copyFile(FIXTURE_DOC, path.join(docs, 'sprint-2026-09-20.md'));
});
afterAll(() => cleanup());

describe('golden fixture', () => {
  test('two fresh compiles produce byte-identical vaults and a second compile changes nothing', async () => {
    const a = await compileFresh(path.join(root, 'vault-a'));
    const b = await compileFresh(path.join(root, 'vault-b'));
    expect(a.first.renderError).toBeUndefined();
    expect(b.first.render).toEqual(a.first.render);
    expect(a.first.render).toMatchObject({
      entities: 6,
      liveClaims: 12,
      questions: 0,
      preserved: [],
    });
    expect(a.first.render?.created).toBeGreaterThan(10);
    expect(a.second.render).toMatchObject({ created: 0, updated: 0, preserved: [] });
    expect(a.second.render?.unchanged).toBe(
      (a.first.render?.created ?? 0) + (a.first.render?.updated ?? 0),
    );
    const sa = await snapshot(path.join(root, 'vault-a'));
    const sb = await snapshot(path.join(root, 'vault-b'));
    expect(Object.keys(sa)).toEqual(Object.keys(sb));
    for (const k of Object.keys(sa)) expect(sa[k]).toBe(sb[k] as string);
    for (const k of Object.keys(sa)) expect(sa[k]).not.toMatch(/2026-09-25T|12:00:0/);
  });

  test('renders the expected notes with resolved wikilinks and correct frontmatter', async () => {
    const vault = path.join(root, 'vault-a');
    const files = await snapshot(vault);
    const names = Object.keys(files);
    expect(names).toEqual(
      expect.arrayContaining([
        'wiki/Projects/Payments Revamp.md',
        'wiki/Projects/Search Relevance.md',
        'wiki/People/Priya Nair.md',
        'wiki/Blockers/Fraud vendor contract unsigned.md',
        'wiki/Commitments/Send revised contract to Legal.md',
        'wiki/Decisions/Ship without personalization in v1.md',
        'wiki/Sources/sprint-2026-09-20.md',
        'days/2026-09-18.md',
        'days/2026-09-20.md',
        'bases/Projects.base',
        'index.md',
        '.cubbon/entities/registry.json',
      ]),
    );
    const payments = files['wiki/Projects/Payments Revamp.md'] as string;
    expect(payments).toContain(
      'status: at-risk\nstatus_since: 2026-09-20\nowner: "[[Priya Nair]]"\ntarget: 2026-11-15\ntarget_was: 2026-10-15',
    );
    expect(payments).toContain('- [[Fraud vendor contract unsigned]] · open since 2026-09-20');
    expect(payments).toContain(
      '- [ ] [[Send revised contract to Legal]] · [[Priya Nair]] · due 2026-09-25',
    );
    expect(files['index.md']).toContain(
      '- **at-risk** (1)\n  - [[Payments Revamp]] · [[Priya Nair]] · target 2026-11-15',
    );
    expect(files['index.md']).toContain('6 entities');

    const known = new Set<string>();
    for (const rel of names) known.add(path.basename(rel).replace(/\.md$/, ''));
    const broken: string[] = [];
    for (const [rel, text] of Object.entries(files)) {
      if (!rel.endsWith('.md')) continue;
      for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
        if (!known.has(m[1] as string)) broken.push(`${rel}: ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
