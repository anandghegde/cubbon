// Dev-only: record a cassette for the golden fixture from the fake extraction, so the compiled
// binary can be smoke-tested with `cubbon compile --cassettes replay` and no API key.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadVaultConfig } from '../src/config/load.ts';
import { CassetteProvider } from '../src/llm/cassette.ts';
import { compile } from '../src/pipeline/compile.ts';
import { createContext } from '../src/pipeline/context.ts';
import { initVault } from '../src/pipeline/init.ts';
import { FIXTURE_DOC, sprintProvider } from '../test/helpers.ts';

const root = process.argv[2] ?? '';
const cassetteDir = process.argv[3] ?? '';
if (!root || !cassetteDir) {
  throw new Error(
    'usage: bun scripts/record-fixture-cassette.ts <scratch> <cassetteDir> [docsDir]',
  );
}
const vault = path.join(root, 'vault');
// The request hash covers the user message, which names the source path: record against the
// same docs folder the binary will scan.
const docs = process.argv[4] ?? path.join(root, 'docs');
await mkdir(docs, { recursive: true });
await copyFile(FIXTURE_DOC, path.join(docs, 'sprint-2026-09-20.md'));
await initVault(vault, { folders: [docs], owner: { name: 'Anand Hegde', email: 'a@example.com' } });
const config = await loadVaultConfig(vault);
const provider = new CassetteProvider(sprintProvider(), cassetteDir, 'record');
const ctx = createContext(vault, config, { provider });
const s = await compile(ctx, { extract: true, render: false });
console.log(`recorded: extracted ${s.extracted}, claims ${s.claims}`);
ctx.close();
