import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { writeVaultConfig } from '../config/load.ts';
import { type ModelSpec, type VaultConfig, VaultConfigSchema } from '../config/schema.ts';
import { EntityRegistry } from '../merge/registry.ts';
import { VAULT_DIRS } from './context.ts';

export const WIKI_FOLDERS = [
  'Projects',
  'Milestones',
  'Blockers',
  'Decisions',
  'Commitments',
  'People',
  'Organizations',
  'External',
  'Sources',
] as const;

/** Graph colour groups by folder (PRD FR5.9). Colours are 0xRRGGBB integers as Obsidian stores them. */
const GRAPH_CONFIG = {
  collapse_filter: false,
  search: '-path:raw -path:.cubbon',
  showTags: false,
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
  collapse_color: false,
  colorGroups: [
    { query: 'path:wiki/Projects', color: { a: 1, rgb: 0x4a90e2 } },
    { query: 'path:wiki/Milestones', color: { a: 1, rgb: 0x50c878 } },
    { query: 'path:wiki/Blockers', color: { a: 1, rgb: 0xe74c3c } },
    { query: 'path:wiki/Decisions', color: { a: 1, rgb: 0x9b59b6 } },
    { query: 'path:wiki/Commitments', color: { a: 1, rgb: 0xf39c12 } },
    { query: 'path:wiki/People', color: { a: 1, rgb: 0xf1c40f } },
    { query: 'path:wiki/Organizations', color: { a: 1, rgb: 0x1abc9c } },
    { query: 'path:wiki/External', color: { a: 1, rgb: 0x95a5a6 } },
    { query: 'path:wiki/Sources', color: { a: 1, rgb: 0xbdc3c7 } },
    { query: 'path:days', color: { a: 1, rgb: 0x7f8c8d } },
  ],
  collapse_display: false,
  showArrow: true,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
  collapse_forces: false,
  centerStrength: 0.5,
  repelStrength: 10,
  linkStrength: 1,
  linkDistance: 250,
  scale: 1,
  close: false,
};

export interface InitOptions {
  folders: string[];
  owner: { name: string; email?: string; aliases?: string[]; organization?: string };
  /** Overrides for models.extractor: model name, OpenAI-compatible base URL, API key variable. */
  extractor?: Partial<ModelSpec>;
}

/** Creates the vault skeleton (PRD FR5 layout) and its configuration. Idempotent. */
export async function initVault(vaultPath: string, opts: InitOptions): Promise<VaultConfig> {
  for (const dir of Object.values(VAULT_DIRS)) {
    await mkdir(path.join(vaultPath, dir), { recursive: true });
  }
  for (const folder of WIKI_FOLDERS) {
    await mkdir(path.join(vaultPath, VAULT_DIRS.wiki, folder), { recursive: true });
  }
  await mkdir(path.join(vaultPath, '.obsidian'), { recursive: true });
  await writeIfMissing(
    path.join(vaultPath, '.obsidian', 'app.json'),
    `${JSON.stringify(
      {
        userIgnoreFilters: ['raw/', '.cubbon/'],
        newFileLocation: 'folder',
        newFileFolderPath: 'wiki',
        showFrontmatter: true,
      },
      null,
      2,
    )}\n`,
  );
  await writeIfMissing(
    path.join(vaultPath, '.obsidian', 'graph.json'),
    `${JSON.stringify(GRAPH_CONFIG, null, 2)}\n`,
  );
  await writeIfMissing(
    path.join(vaultPath, '.obsidian', 'daily-notes.json'),
    `${JSON.stringify({ folder: VAULT_DIRS.days, format: 'YYYY-MM-DD' }, null, 2)}\n`,
  );
  await EntityRegistry.writeDefaultAliases(path.join(vaultPath, VAULT_DIRS.cubbon));
  await writeIfMissing(
    path.join(vaultPath, '.gitignore'),
    [
      '.cubbon/state.db',
      '.cubbon/state.db-*',
      '.cubbon/logs/',
      '.obsidian/workspace*.json',
      '',
    ].join('\n'),
  );
  await writeIfMissing(
    path.join(vaultPath, 'index.md'),
    [
      '---',
      'type: hub',
      '---',
      '# Cubbon',
      '',
      '<!-- cubbon:begin hub -->',
      'This vault is compiled by Cubbon. Run `cubbon compile` to populate it.',
      '<!-- cubbon:end hub -->',
      '',
      '## Notes',
      '',
      'This hub is regenerated on every compile. Write anything you like outside the generated block.',
      '',
    ].join('\n'),
  );
  const config = VaultConfigSchema.parse({
    owner: {
      name: opts.owner.name,
      email: opts.owner.email,
      aliases: opts.owner.aliases ?? [],
      organization: opts.owner.organization,
    },
    watch: { folders: opts.folders, excludePaths: [vaultPath] },
    models: opts.extractor
      ? {
          extractor: {
            provider: opts.extractor.provider ?? 'openai',
            model: opts.extractor.model ?? 'gpt-4.1-mini',
            baseUrl: opts.extractor.baseUrl,
            apiKeyEnv: opts.extractor.apiKeyEnv,
          },
        }
      : undefined,
  });
  await writeVaultConfig(vaultPath, config);
  return config;
}

async function writeIfMissing(file: string, content: string): Promise<void> {
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}
