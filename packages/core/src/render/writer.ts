import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { splitFrontmatter } from '../parse/frontmatter.ts';
import { sha256Hex } from '../util/hash.ts';
import { frontmatter } from './format.ts';
import { MANAGED_KEYS, type RenderedBlock, type RenderedNote } from './note.ts';

export interface PreservedEdit {
  block: string;
  text: string;
}

export interface WriteOutcome {
  path: string;
  action: 'created' | 'updated' | 'unchanged';
  preserved: PreservedEdit[];
  /** Block name -> hash of the rendered block body. Store it to detect edits next time. */
  renderHashes: Record<string, string>;
}

const BLOCK_RE = /<!-- cubbon:begin ([\w-]+) -->\n?([\s\S]*?)\n?<!-- cubbon:end \1 -->/g;

function fence(b: RenderedBlock): string {
  return `<!-- cubbon:begin ${b.name} -->\n${b.body}\n<!-- cubbon:end ${b.name} -->`;
}

function renderFull(note: RenderedNote): string {
  const parts: string[] = [frontmatter(note.frontmatter), `# ${note.title}`, ''];
  for (const b of note.blocks) {
    if (b.heading) parts.push(b.heading);
    parts.push(fence(b), '');
  }
  parts.push('## Notes', '', note.notesHint ?? '', '');
  return `${parts
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function hashOf(text: string): string {
  return sha256Hex(text.trim()).slice(0, 16);
}

/**
 * Block-preserving writer (PRD FR5.3). Text outside markers is never touched. A block whose text
 * differs from what Cubbon last rendered was edited by hand: the edit is moved under Notes and
 * the block is regenerated. Frontmatter keys outside the managed set are preserved.
 */
export async function writeNote(
  vaultPath: string,
  note: RenderedNote,
  previousHashes: Record<string, string> | undefined,
  today: string,
): Promise<WriteOutcome> {
  const file = path.join(vaultPath, note.path);
  const renderHashes: Record<string, string> = {};
  for (const b of note.blocks) renderHashes[b.name] = hashOf(b.body);

  let existing: string | null = null;
  try {
    existing = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (existing === null) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, renderFull(note), 'utf8');
    return { path: note.path, action: 'created', preserved: [], renderHashes };
  }

  const fm = splitFrontmatter(existing);
  const userKeys: Record<string, unknown> = {};
  if (fm.data) {
    for (const [k, v] of Object.entries(fm.data)) if (!MANAGED_KEYS.has(k)) userKeys[k] = v;
  }
  const newFrontmatter = frontmatter({ ...note.frontmatter, ...userKeys });

  const preserved: PreservedEdit[] = [];
  const seen = new Set<string>();
  let body = fm.body.replace(BLOCK_RE, (whole, name: string, inner: string) => {
    const block = note.blocks.find((b) => b.name === name);
    if (!block) return whole;
    seen.add(name);
    // Without a baseline (a note Cubbon never rendered) an edit cannot be told from a placeholder.
    if (previousHashes && inner.trim() !== block.body.trim()) {
      if (previousHashes[name] !== hashOf(inner))
        preserved.push({ block: name, text: inner.trim() });
    }
    return fence(block);
  });

  const missing = note.blocks.filter((b) => !seen.has(b.name));
  if (missing.length) {
    const addition = missing
      .map((b) => `${b.heading ? `${b.heading}\n` : ''}${fence(b)}\n`)
      .join('\n');
    const notesAt = body.search(/^## Notes\s*$/m);
    body =
      notesAt >= 0
        ? `${body.slice(0, notesAt).trimEnd()}\n\n${addition}\n${body.slice(notesAt)}`
        : `${body.trimEnd()}\n\n${addition}`;
  }
  if (preserved.length) {
    const additions = preserved
      .map((p) => `\n### Preserved edit ${today} (${p.block})\n\n${p.text}\n`)
      .join('');
    body = /^## Notes\s*$/m.test(body)
      ? `${body.trimEnd()}\n${additions}`
      : `${body.trimEnd()}\n\n## Notes\n${additions}`;
  }

  const next = `${newFrontmatter}${body.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  if (next === existing) return { path: note.path, action: 'unchanged', preserved, renderHashes };
  await writeFile(file, next, 'utf8');
  return { path: note.path, action: 'updated', preserved, renderHashes };
}

/** For fully generated files (day pages, bases): write only when the content differs. */
export async function writeIfChanged(
  vaultPath: string,
  rel: string,
  content: string,
): Promise<'created' | 'updated' | 'unchanged'> {
  const file = path.join(vaultPath, rel);
  try {
    if ((await readFile(file, 'utf8')) === content) return 'unchanged';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
    return 'created';
  }
  await writeFile(file, content, 'utf8');
  return 'updated';
}
