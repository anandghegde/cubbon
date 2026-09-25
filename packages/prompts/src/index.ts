import document from '../document.md' with { type: 'text' };

export const PROMPTS = {
  document,
} as const;

export type PromptName = keyof typeof PROMPTS;
