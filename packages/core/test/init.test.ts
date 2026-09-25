import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { loadVaultConfig } from '../src/config/load.ts';
import { initVault } from '../src/pipeline/init.ts';
import { tempDir } from './helpers.ts';

describe('init', () => {
  test('extractor overrides land in config.yaml and defaults fill the rest', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const vault = path.join(dir, 'vault');
      await initVault(vault, {
        folders: [path.join(dir, 'docs')],
        owner: { name: 'A' },
        extractor: {
          model: 'deepseek-v4-flash',
          baseUrl: 'https://api.surplusintelligence.ai/v1',
          apiKeyEnv: 'SURPLUS_API_KEY',
        },
      });
      const config = await loadVaultConfig(vault);
      expect(config.models.extractor).toEqual({
        provider: 'openai',
        model: 'deepseek-v4-flash',
        baseUrl: 'https://api.surplusintelligence.ai/v1',
        apiKeyEnv: 'SURPLUS_API_KEY',
      });
      expect(config.models.triage.provider).toBe('ollama');
    } finally {
      await cleanup();
    }
  });

  test('without overrides the extractor is the openai default', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      const vault = path.join(dir, 'vault');
      await initVault(vault, { folders: [path.join(dir, 'docs')], owner: { name: 'A' } });
      const config = await loadVaultConfig(vault);
      expect(config.models.extractor).toEqual({ provider: 'openai', model: 'gpt-4.1-mini' });
    } finally {
      await cleanup();
    }
  });
});
