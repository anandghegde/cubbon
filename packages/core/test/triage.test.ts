import { describe, expect, test } from 'bun:test';
import { parseDocument } from '../src/parse/markdown.ts';
import { detectSourceType, triageHeuristic } from '../src/triage/heuristics.ts';

const opts = { minBytes: 50, force: {} };
const t = (p: string, text: string, force = {}) =>
  triageHeuristic({ path: p, size: text.length, parsed: parseDocument(text) }, { ...opts, force });

describe('triage heuristics', () => {
  test('work documents score high', () => {
    const d = t(
      '/d/roadmap.md',
      '# Q4 Roadmap\n\nProject Payments Revamp, owner Priya. Milestone beta on 2026-11-15. Status: at risk.\n',
    );
    expect(d.decision).toBe('work');
    expect(d.sourceType).toBe('document');
  });
  test('small files, boilerplate and code docs are ignored', () => {
    expect(t('/d/x.md', 'tiny').decision).toBe('ignore');
    expect(
      t('/repo/README.md', `# Project foo\n\n${'status owner sprint '.repeat(20)}`).reason,
    ).toContain('boilerplate');
    const code = `# API\n\n\`\`\`ts\nconst a = 1\n\`\`\`\n\n\`\`\`ts\nconst b = 2\n\`\`\`\n\n\`\`\`ts\nconst c = 3\n\`\`\`\n${'x'.repeat(100)}`;
    expect(t('/repo/docs/api.md', code).reason).toContain('code documentation');
  });
  test('no signals is ignored, weak signals are unsure', () => {
    expect(
      t('/d/recipe.md', `# Pancakes\n\nMix flour and eggs. ${'Cook well. '.repeat(10)}`).decision,
    ).toBe('ignore');
    expect(
      t('/d/note.md', `# Thoughts\n\nThe customer called. ${'Nothing else. '.repeat(10)}`).decision,
    ).toBe('unsure');
  });
  test('force overrides', () => {
    expect(
      t('/d/recipe.md', `# Pancakes\n\n${'Cook well. '.repeat(10)}`, { '/d': 'work' }).decision,
    ).toBe('work');
    expect(
      t('/d/roadmap.md', '# Roadmap\n\nproject status owner 2026-01-01 sprint', {
        '/d/*.md': 'ignore',
      }).decision,
    ).toBe('ignore');
  });
  test('source type detection', () => {
    const st = (p: string, text: string) =>
      detectSourceType({ path: p, size: text.length, parsed: parseDocument(text) });
    expect(st('/m/x.md', '---\nfrom: a@b.com\nsubject: Hi\n---\nbody')).toBe('email');
    expect(st('/m/x.md', 'From: a@b.com\nTo: c@d.com\nSubject: Hi\n\nbody')).toBe('email');
    expect(st('/m/x.md', '---\nkey: PAY-12\nstatus: Open\n---\nbody')).toBe('ticket');
    expect(st('/m/PAY-12.md', '# Fix checkout\n\nbody')).toBe('ticket');
    expect(st('/m/weekly-sync.md', '# Notes\n\nbody')).toBe('meeting');
    expect(st('/m/x.md', '# Sync\n\n## Attendees\n\n- a\n')).toBe('meeting');
    const chat = Array.from(
      { length: 10 },
      (_, i) => `[10:${String(i).padStart(2, '0')}] Priya: message ${i}`,
    ).join('\n');
    expect(st('/m/x.md', chat)).toBe('chat');
    expect(st('/m/prd.md', '# PRD\n\nGoals')).toBe('document');
  });
});
