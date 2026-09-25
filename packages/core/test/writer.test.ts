import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RenderedNote } from '../src/render/note.ts';
import { writeIfChanged, writeNote } from '../src/render/writer.ts';
import { tempDir } from './helpers.ts';

let vault: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ dir: vault, cleanup } = await tempDir());
});
afterAll(() => cleanup());

function note(status: string, extra: Partial<RenderedNote> = {}): RenderedNote {
  return {
    path: 'wiki/Projects/Atlas.md',
    title: 'Atlas',
    frontmatter: { type: 'project', cubbon_id: 'prj_1', status, first_seen: '2026-09-20' },
    blocks: [
      { name: 'summary', body: `Atlas is ${status}.` },
      { name: 'status', heading: '## Status log', body: `- 2026-09-20 · **${status}**` },
    ],
    notesHint: 'Yours.',
    ...extra,
  };
}

const read = () => readFile(path.join(vault, 'wiki/Projects/Atlas.md'), 'utf8');

describe('writeNote', () => {
  test('creates a note with frontmatter, fenced blocks and a Notes region', async () => {
    const out = await writeNote(vault, note('on-track'), undefined, '2026-09-25');
    expect(out.action).toBe('created');
    expect(Object.keys(out.renderHashes)).toEqual(['summary', 'status']);
    const text = await read();
    expect(text).toBe(
      [
        '---',
        'type: project',
        'cubbon_id: prj_1',
        'status: on-track',
        'first_seen: 2026-09-20',
        '---',
        '',
        '# Atlas',
        '',
        '<!-- cubbon:begin summary -->',
        'Atlas is on-track.',
        '<!-- cubbon:end summary -->',
        '',
        '## Status log',
        '<!-- cubbon:begin status -->',
        '- 2026-09-20 · **on-track**',
        '<!-- cubbon:end status -->',
        '',
        '## Notes',
        '',
        'Yours.',
        '',
      ].join('\n'),
    );
  });

  test('rewriting the same content is a no-op', async () => {
    const first = await writeNote(vault, note('on-track'), undefined, '2026-09-25');
    const out = await writeNote(vault, note('on-track'), first.renderHashes, '2026-09-26');
    expect(out.action).toBe('unchanged');
  });

  test('keeps user text and frontmatter keys while regenerating blocks', async () => {
    const before = await read();
    await writeFile(
      path.join(vault, 'wiki/Projects/Atlas.md'),
      `${before.replace('first_seen: 2026-09-20', 'first_seen: 2026-09-20\ntags: [work, q4]')}\nMy own paragraph.\n\n## My section\n\n- a private todo\n`,
    );
    const hashes = (await writeNote(vault, note('on-track'), undefined, '2026-09-25')).renderHashes;
    const out = await writeNote(vault, note('at-risk'), hashes, '2026-09-26');
    expect(out.action).toBe('updated');
    expect(out.preserved).toEqual([]);
    const text = await read();
    expect(text).toContain('status: at-risk');
    expect(text).toContain('tags:\n  - work\n  - q4');
    expect(text.indexOf('tags:')).toBeGreaterThan(text.indexOf('first_seen'));
    expect(text).toContain('Atlas is at-risk.');
    expect(text).not.toContain('Atlas is on-track.');
    expect(text).toContain('My own paragraph.\n\n## My section\n\n- a private todo\n');
  });

  test('an edit inside a block is moved under Notes and the block regenerated', async () => {
    const hashes = (await writeNote(vault, note('at-risk'), undefined, '2026-09-25')).renderHashes;
    const text = await read();
    await writeFile(
      path.join(vault, 'wiki/Projects/Atlas.md'),
      text.replace(
        '- 2026-09-20 · **at-risk**',
        '- 2026-09-20 · **at-risk**\n- I typed this by hand',
      ),
    );
    const out = await writeNote(vault, note('at-risk'), hashes, '2026-09-27');
    expect(out.action).toBe('updated');
    expect(out.preserved).toEqual([
      { block: 'status', text: '- 2026-09-20 · **at-risk**\n- I typed this by hand' },
    ]);
    const after = await read();
    expect(after).toContain(
      '<!-- cubbon:begin status -->\n- 2026-09-20 · **at-risk**\n<!-- cubbon:end status -->',
    );
    expect(after).toContain(
      '### Preserved edit 2026-09-27 (status)\n\n- 2026-09-20 · **at-risk**\n- I typed this by hand',
    );
    expect(after).toContain('My own paragraph.');
  });

  test('new blocks are inserted before Notes; blocks no longer rendered are left alone', async () => {
    const hashes = (await writeNote(vault, note('at-risk'), undefined, '2026-09-25')).renderHashes;
    const next = note('at-risk', {
      blocks: [
        { name: 'summary', body: 'Atlas is at-risk.' },
        { name: 'questions', heading: '## Open questions', body: '- Who owns QA?' },
      ],
    });
    const out = await writeNote(vault, next, hashes, '2026-09-28');
    expect(out.action).toBe('updated');
    const text = await read();
    const q = text.indexOf('## Open questions\n<!-- cubbon:begin questions -->');
    expect(q).toBeGreaterThan(0);
    expect(q).toBeLessThan(text.indexOf('## Notes'));
    expect(text).toContain('<!-- cubbon:begin status -->');
  });

  test('without a baseline a differing block is regenerated, not preserved', async () => {
    await writeFile(
      path.join(vault, 'index.md'),
      '---\ntype: hub\n---\n# Cubbon\n\n<!-- cubbon:begin hub -->\nplaceholder\n<!-- cubbon:end hub -->\n\n## Notes\n',
    );
    const hub: RenderedNote = {
      path: 'index.md',
      title: 'Cubbon',
      frontmatter: { type: 'hub' },
      blocks: [{ name: 'hub', body: '## Projects\n- none' }],
    };
    const out = await writeNote(vault, hub, undefined, '2026-09-25');
    expect(out.action).toBe('updated');
    expect(out.preserved).toEqual([]);
    expect(await readFile(path.join(vault, 'index.md'), 'utf8')).not.toContain('placeholder');
  });
});

describe('writeIfChanged', () => {
  test('creates, then reports unchanged, then updated', async () => {
    expect(await writeIfChanged(vault, 'days/2026-09-20.md', 'a\n')).toBe('created');
    expect(await writeIfChanged(vault, 'days/2026-09-20.md', 'a\n')).toBe('unchanged');
    expect(await writeIfChanged(vault, 'days/2026-09-20.md', 'b\n')).toBe('updated');
  });
});
