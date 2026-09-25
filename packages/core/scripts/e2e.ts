// Dev-only: compile the golden fixture into a fresh vault at argv[2] and print summaries.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadVaultConfig } from '../src/config/load.ts';
import { compile } from '../src/pipeline/compile.ts';
import { createContext } from '../src/pipeline/context.ts';
import { initVault } from '../src/pipeline/init.ts';
import { FIXTURE_DOC, sprintProvider } from '../test/helpers.ts';

const root = process.argv[2] ?? '';
if (!root) throw new Error('usage: bun scripts/e2e.ts <dir>');
const vault = path.join(root, 'vault');
const docs = path.join(root, 'docs');
await mkdir(docs, { recursive: true });
await copyFile(FIXTURE_DOC, path.join(docs, 'sprint-2026-09-20.md'));
await initVault(vault, { folders: [docs], owner: { name: 'Anand Hegde', email: 'a@example.com' } });
const config = await loadVaultConfig(vault);
let tick = 0;
const ctx = createContext(vault, config, {
  provider: sprintProvider(),
  now: () => new Date(Date.UTC(2026, 8, 25, 12, 0, tick++)),
});
const s1 = await compile(ctx, { extract: true });
console.log(JSON.stringify({ ...s1, outcomes: undefined }, null, 1));
const s2 = await compile(ctx, { extract: true });
console.log(JSON.stringify(s2.render, null, 1), s2.renderError ?? '');
ctx.close();
