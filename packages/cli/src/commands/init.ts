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
    .option('--model <name>', 'extractor model (default: gpt-4.1-mini)')
    .option(
      '--base-url <url>',
      'OpenAI-compatible endpoint, e.g. https://api.surplusintelligence.ai/v1 or http://localhost:11434/v1',
    )
    .option(
      '--api-key-env <name>',
      'environment variable holding the API key (default: OPENAI_API_KEY)',
    )
    .action(
      async (
        vault: string,
        opts: {
          folder?: string[];
          ownerName?: string;
          ownerEmail?: string;
          model?: string;
          baseUrl?: string;
          apiKeyEnv?: string;
        },
      ) => {
        const vaultPath = path.resolve(expandHome(vault));
        const folders = (opts.folder ?? ['~/Documents', '~/Downloads', '~/Desktop']).map((f) =>
          path.resolve(expandHome(f)),
        );
        const ownerName = opts.ownerName ?? os.userInfo().username;
        const owner: { name: string; email?: string } = { name: ownerName };
        if (opts.ownerEmail) owner.email = opts.ownerEmail;
        const extractor =
          opts.model || opts.baseUrl || opts.apiKeyEnv
            ? { model: opts.model, baseUrl: opts.baseUrl, apiKeyEnv: opts.apiKeyEnv }
            : undefined;
        const config = await initVault(vaultPath, { folders, owner, extractor });
        console.log(`Vault created at ${contractHome(vaultPath)}`);
        console.log(`Watching: ${folders.map(contractHome).join(', ')}`);
        console.log(`Owner: ${ownerName}${opts.ownerEmail ? ` <${opts.ownerEmail}>` : ''}`);
        console.log('');
        console.log(
          `Edit ${contractHome(path.join(vaultPath, '.cubbon', 'config.yaml'))} to adjust folders, owner and models.`,
        );
        const spec = config.models.extractor;
        console.log(
          `Extractor: ${spec.model} at ${spec.baseUrl ?? 'https://api.openai.com/v1'} (--model, --base-url, --api-key-env to change).`,
        );
        console.log(
          `Set ${spec.apiKeyEnv ?? 'OPENAI_API_KEY'} (not needed for local servers), then run \`cubbon compile\`.`,
        );
      },
    );
}
