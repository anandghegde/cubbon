import type { MergeResult } from '../merge/merge.ts';
import type { Claim } from '../model/types.ts';
import type { RenderContext } from './entities.ts';
import { frontmatter, link } from './format.ts';
import { describeObject, subjectLink } from './sources.ts';

/** Day pages by valid time (PRD FR5.6). Fully generated; one file per date with a claim. */
export function renderDays(
  claims: Claim[],
  ctx: RenderContext,
  merge: MergeResult,
): Map<string, string> {
  const byDay = new Map<string, Claim[]>();
  for (const c of claims) {
    const list = byDay.get(c.validFrom) ?? [];
    list.push(c);
    byDay.set(c.validFrom, list);
  }
  const pages = new Map<string, string>();
  for (const [day, all] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const live = all.filter((c) => c.supersededAt === undefined);
    const shown = live.length ? live : all;
    const lines = shown
      .map((c) => ({ c, subject: subjectLink(ctx, merge, c) }))
      .sort(
        (a, b) =>
          a.subject.localeCompare(b.subject) ||
          a.c.predicate.localeCompare(b.c.predicate) ||
          a.c.id.localeCompare(b.c.id),
      )
      .map(({ c, subject }) => {
        const file = ctx.sourceFile(c.sourceHash);
        const parts = [
          subject,
          `${c.predicate} → ${describeObject(ctx, merge, c)}`,
          file ? link(file) : '',
        ];
        return `- ${parts.filter(Boolean).join(' · ')}${c.supersededAt ? ' · superseded' : ''}`;
      });
    const body = `${frontmatter({ type: 'day', date: day, claims: shown.length })}# ${day}\n\n${lines.join('\n')}\n`;
    pages.set(`days/${day}.md`, body);
  }
  return pages;
}
