import { currentDate, currentStatus, liveLinks, type MergeResult } from '../merge/merge.ts';
import type { EntityRecord } from '../model/entities.ts';
import { PROJECT_STATUSES } from '../model/types.ts';
import type { RenderContext } from './entities.ts';
import { fmtDate, link, plural } from './format.ts';
import type { RenderedNote } from './note.ts';

/** index.md hub (PRD 3.12): projects by status, open blockers, due commitments, upcoming milestones. */
export function renderHub(
  merge: MergeResult,
  ctx: RenderContext,
  sourceCount: number,
): RenderedNote {
  const all = [...merge.entities.values()].filter((e) => !e.retired);
  const projects = all.filter((e) => e.type === 'project');
  const lines: string[] = [];

  lines.push('## Projects');
  for (const status of [...PROJECT_STATUSES, undefined]) {
    const group = projects.filter((p) => currentStatus(p)?.status === status).sort(byName);
    if (!group.length) continue;
    lines.push(`- **${status ?? 'no status'}** (${group.length})`);
    for (const p of group) {
      const owner = liveLinks(p, 'owner')[0];
      const ownerEntity = owner ? ctx.entities.get(owner.target) : undefined;
      const target = currentDate(p, 'target');
      const parts = [link(p.fileName, p.name)];
      if (ownerEntity) parts.push(link(ownerEntity.fileName, ownerEntity.name));
      if (target) parts.push(`target ${fmtDate(target.date, target.precision)}`);
      lines.push(`  - ${parts.join(' · ')}`);
    }
  }
  if (!projects.length) lines.push('- _No projects yet. Run `cubbon compile` with extraction on._');

  const blockers = all
    .filter((e) => e.type === 'blocker' && !currentDate(e, 'resolved'))
    .sort(byName);
  lines.push('', `## Open blockers (${blockers.length})`);
  for (const b of blockers) {
    const blocked = liveLinks(b, 'blocks')
      .map((l) => ctx.entities.get(l.target))
      .filter(Boolean) as EntityRecord[];
    lines.push(
      `- ${link(b.fileName, b.name)} · since ${b.firstSeen}${blocked.length ? ` · ${blocked.map((x) => link(x.fileName, x.name)).join(', ')}` : ''}`,
    );
  }

  const commitments = all
    .filter((e) => e.type === 'commitment' && !currentDate(e, 'done'))
    .sort(
      (a, b) =>
        (currentDate(a, 'due')?.date ?? '9999').localeCompare(
          currentDate(b, 'due')?.date ?? '9999',
        ) || byName(a, b),
    );
  lines.push('', `## Open commitments (${commitments.length})`);
  for (const c of commitments) {
    const due = currentDate(c, 'due');
    const assignee = liveLinks(c, 'assignee')[0];
    const who = assignee ? ctx.entities.get(assignee.target) : undefined;
    const parts = [link(c.fileName, c.name)];
    if (who) parts.push(link(who.fileName, who.name));
    if (due)
      parts.push(
        `due ${fmtDate(due.date, due.precision)}${due.date < ctx.asOf ? ' (overdue)' : ''}`,
      );
    lines.push(`- [ ] ${parts.join(' · ')}`);
  }

  const milestones = all
    .filter((e) => e.type === 'milestone' && currentDate(e, 'target'))
    .sort(
      (a, b) =>
        (currentDate(a, 'target')?.date ?? '').localeCompare(
          currentDate(b, 'target')?.date ?? '',
        ) || byName(a, b),
    );
  lines.push('', `## Milestones (${milestones.length})`);
  for (const m of milestones) {
    const t = currentDate(m, 'target');
    const status = currentStatus(m);
    lines.push(
      `- ${t ? fmtDate(t.date, t.precision) : ''} · ${link(m.fileName, m.name)}${status ? ` · ${status.status}` : ''}`,
    );
  }

  lines.push(
    '',
    '## Views',
    '- [[Projects.base|Projects board]]',
    '- [[Milestones.base|Milestones]]',
    '- [[Blockers.base|Blockers]]',
    '- [[Commitments.base|Commitments]]',
  );
  lines.push(
    '',
    '## Ledger',
    `- ${plural(sourceCount, 'source document')}, ${plural(merge.stats.live, 'live claim')}, ${plural(merge.stats.entities, 'entity', 'entities')}, ${plural(merge.stats.questions, 'open question')}${ctx.asOf ? ` · as of ${ctx.asOf}` : ''}`,
  );

  return {
    path: 'index.md',
    title: 'Cubbon',
    frontmatter: { type: 'hub' },
    blocks: [{ name: 'hub', body: lines.join('\n') }],
    notesHint:
      'This hub is regenerated on every compile. Write anything you like outside the generated block.',
  };
}

function byName(a: EntityRecord, b: EntityRecord): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
