import { z } from 'zod';

export const DEFAULT_EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.obsidian',
  '.cubbon',
  '.trash',
  '.Trash',
  'Library',
  '.cache',
  '.npm',
  '.bun',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'target',
  '.next',
  '.idea',
  '.vscode',
  'Applications',
  'Music',
  'Movies',
  'Pictures',
];

export const ModelSpecSchema = z.object({
  /** openai: any OpenAI-compatible Chat Completions endpoint. ollama: the native Ollama API. */
  provider: z.enum(['openai', 'ollama', 'fake']),
  model: z.string().min(1),
  /** For openai, a /v1 base URL (OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM, ...). */
  baseUrl: z.string().optional(),
  /** Environment variable that holds the API key. Default OPENAI_API_KEY. */
  apiKeyEnv: z.string().optional(),
});
export type ModelSpec = z.infer<typeof ModelSpecSchema>;

export const VaultConfigSchema = z.object({
  version: z.literal(1).default(1),
  owner: z
    .object({
      name: z.string().default(''),
      email: z.string().optional(),
      aliases: z.array(z.string()).default([]),
      organization: z.string().optional(),
    })
    .prefault({}),
  watch: z
    .object({
      folders: z.array(z.string()).default([]),
      extensions: z.array(z.string()).default(['.md', '.markdown']),
      excludeDirs: z.array(z.string()).default(DEFAULT_EXCLUDE_DIRS),
      excludePaths: z.array(z.string()).default([]),
      maxFileBytes: z.number().int().positive().default(2_000_000),
    })
    .prefault({}),
  models: z
    .object({
      extractor: ModelSpecSchema.prefault({ provider: 'openai', model: 'gpt-4.1-mini' }),
      triage: ModelSpecSchema.prefault({
        provider: 'ollama',
        model: 'qwen3:4b',
        baseUrl: 'http://localhost:11434',
      }),
      localOnly: z.boolean().default(false),
    })
    .prefault({}),
  limits: z
    .object({
      concurrency: z.number().int().min(1).max(64).default(8),
      dailySpendUsd: z.number().nonnegative().default(5),
      maxChunkChars: z.number().int().min(2000).default(24_000),
    })
    .prefault({}),
  merge: z.object({ threshold: z.number().min(0).max(1).default(0.8) }).prefault({}),
  triage: z
    .object({
      /** Path prefix or glob -> forced decision. */
      force: z.record(z.string(), z.enum(['work', 'ignore'])).default({}),
      /** Files smaller than this are ignored without a model call. */
      minBytes: z.number().int().nonnegative().default(200),
    })
    .prefault({}),
  cassettes: z
    .object({
      dir: z.string().optional(),
      mode: z.enum(['off', 'replay', 'record', 'auto']).default('off'),
    })
    .prefault({}),
});
export type VaultConfig = z.infer<typeof VaultConfigSchema>;

export const GlobalConfigSchema = z.object({
  defaultVault: z.string().optional(),
  openaiApiKey: z.string().optional(),
  telemetry: z.boolean().default(false),
});
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
