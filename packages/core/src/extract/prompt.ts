import { PROMPTS } from '@cubbon/prompts';
import { renderOntology } from '../model/ontology.ts';
import {
  type DocDate,
  type OwnerIdentity,
  PROJECT_STATUSES,
  type SourceType,
} from '../model/types.ts';
import type { Chunk } from '../parse/chunk.ts';

export function renderOwnerBlock(owner: OwnerIdentity): string {
  const lines = [`Name: ${owner.name || '(unknown)'}`];
  if (owner.email) lines.push(`Email: ${owner.email}`);
  if (owner.aliases.length) lines.push(`Also written as: ${owner.aliases.join(', ')}`);
  if (owner.organization) lines.push(`Organization: ${owner.organization}`);
  lines.push(
    'First person pronouns (I, me, my) in documents written by the owner refer to this person.',
  );
  return lines.join('\n');
}

export function buildSystemPrompt(
  owner: OwnerIdentity,
  template: string = PROMPTS.document,
): string {
  return template
    .replaceAll('{{owner}}', renderOwnerBlock(owner))
    .replaceAll('{{ontology}}', renderOntology())
    .replaceAll('{{statuses}}', PROJECT_STATUSES.join(', '));
}

export interface UserMessageContext {
  filePath: string;
  title: string | null;
  sourceType: SourceType;
  docDate: DocDate;
  chunk: Chunk;
  chunkCount: number;
}

export function buildUserMessage(ctx: UserMessageContext): string {
  const lines: string[] = [];
  lines.push(`Document title: ${ctx.title ?? '(none)'}`);
  lines.push(`File: ${ctx.filePath}`);
  lines.push(`Source type: ${ctx.sourceType}`);
  lines.push(
    `Document date: ${ctx.docDate.date} (from ${ctx.docDate.method}, confidence ${ctx.docDate.confidence})`,
  );
  if (ctx.chunk.headingPath.length) lines.push(`Section: ${ctx.chunk.headingPath.join(' > ')}`);
  lines.push(`Chunk ${ctx.chunk.index + 1} of ${ctx.chunkCount}`);
  lines.push('');
  lines.push('<chunk>');
  lines.push(ctx.chunk.text);
  lines.push('</chunk>');
  return lines.join('\n');
}
