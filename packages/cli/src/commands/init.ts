import os from 'node:os';
import path from 'node:path';
import { contractHome, expandHome, initVault } from '@cubbon/core';
import type { Command } from 'commander';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create a vault and its configuration.')
    .argument('[vault]', 'vault directory', path.join(os.homedir(), 'Cubbon'))
    .option(
      '-f, --folder <path...>',
      'folders to watch (default: ~/Documents ~/Downloads ~/Desktop)',
    )
    .option('--owner-name <name>', 'your name, used to resolve "I" in documents')
    .option('--owner-email <email>', 'your email address')
    .action(
      async (
        vault: string,
        opts: { folder?: string[]; ownerName?: string; ownerEmail?: string },
      ) => {
        const vaultPath = path.resolve(expandHome(vault));
        const folders = (opts.folder ?? ['~/Documents', '~/Downloads', '~/Desktop']).map((f) =>
          path.resolve(expandHome(f)),
        );
        const ownerName = opts.ownerName ?? os.userInfo().username;
        const owner: { name: string; email?: string } = { name: ownerName };
        if (opts.ownerEmail) owner.email = opts.ownerEmail;
        await initVault(vaultPath, { folders, owner });
        console.log(`Vault created at ${contractHome(vaultPath)}`);
        console.log(`Watching: ${folders.map(contractHome).join(', ')}`);
        console.log(`Owner: ${ownerName}${opts.ownerEmail ? ` <${opts.ownerEmail}>` : ''}`);
        console.log('');
        console.log(
          `Edit ${contractHome(path.join(vaultPath, '.cubbon', 'config.yaml'))} to adjust folders, owner and models.`,
        );
        console.log(
          'Set OPENAI_API_KEY (or point models.extractor.baseUrl at a local OpenAI-compatible server), then run `cubbon compile`.',
        );
      },
    );
}
