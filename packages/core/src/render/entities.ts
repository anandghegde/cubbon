import { bestText, currentDate, currentStatus, liveLinks } from '../merge/merge.ts';
import { externalKey, externalKind } from '../merge/normalize.ts';
import type {
  DateEntry,
  EntityRecord,
  LinkEntry,
  Provenance,
  StatusEntry,
} from '../model/entities.ts';
import type { EntityType } from '../model/types.ts';
import { fmtDate, link, oneLine, quote } from './format.ts';
import type { RenderedBlock, RenderedNote } from './note.ts';

export const FOLDER: Record<EntityType, string> = {
  project: 'wiki/Projects',
  milestone: 'wiki/Milestones',
  blocker: 'wiki/Blockers',
  decision: 'wiki/Decisions',
  commitment: 'wiki/Commitments',
  person: 'wiki/People',
  organization: 'wiki/Organizations',
  external: 'wiki/External',
  source: 'wiki/Sources',
};

export interface Incoming {
  from: EntityRecord;
  link: LinkEntry;
}

export interface RenderContext {
  entities: Map<string, EntityRecord>;
  /** target id -> links pointing at it */
  incoming: Map<string, Incoming[]>;
  /** source hash -> source note filename */
  sourceFile: (hash: string) => string | undefined;
  /** Reference date for "overdue" and "open for N days": the latest document date. */
  asOf: string;
}

export function buildIncoming(entities: Map<string, EntityRecord>): Map<string, Incoming[]> {
  const incoming = new Map<string, Incoming[]>();
  for (const from of entities.values()) {
    for (const l of from.links) {
      const list = incoming.get(l.target) ?? [];
      list.push({ from, link: l });
      incoming.set(l.target, list);
    }
  }
  for (const list of incoming.values()) {
    list.sort(
      (a, b) => a.from.name.localeCompare(b.from.name) || a.from.id.localeCompare(b.from.id),
    );
  }
  return incoming;
}

const NONE = '_None yet._';

function src(ctx: RenderContext, p: Provenance | undefined): string {
  if (!p) return '';
  const file = ctx.sourceFile(p.sourceHash);
  const parts = [file ? link(file) : `src ${p.sourceHash.slice(0, 8)}`, p.confidence.toFixed(2)];
  return parts.join(' · ');
}

function entityLink(ctx: RenderContext, id: string): string {
  const e = ctx.entities.get(id);
  return e ? link(e.fileName, e.name) : `\`${id}\``;
}

function supersededSuffix(x: { superseded: boolean }): string {
  return x.superseded ? ' · superseded' : '';
}

function statusLine(ctx: RenderContext, s: StatusEntry): string {
  const p = s.claims[0] as Provenance;
  const parts = [s.date, `**${s.status}**`];
  if (p.evidence) parts.push(quote(p.evidence));
  parts.push(src(ctx, p));
  if (s.claims.length > 1) parts.push(`+${s.claims.length - 1} corroborating`);
  if (s.conflict) parts.push('conflicts with the entry above');
  return `- ${parts.join(' · ')}${supersededSuffix(s)}`;
}

function dateLine(ctx: RenderContext, d: DateEntry, label: string): string {
  const p = d.claims[0] as Provenance;
  const parts = [`recorded ${p.recordedAt}`, `${label} ${fmtDate(d.date, d.precision)}`];
  if (d.validTo) parts.push(`until ${d.validTo}`);
  if (p.evidence) parts.push(quote(p.evidence));
  parts.push(src(ctx, p));
  return `- ${parts.join(' · ')}${supersededSuffix(d)}`;
}

function summaryBlock(e: EntityRecord): RenderedBlock {
  const texts = (e.texts.description ?? []).filter((t) => !t.superseded);
  const body = texts.length ? texts.map((t) => oneLine(t.text)).join(' ') : NONE;
  return { name: 'summary', body };
}

function questionsBlock(e: EntityRecord): RenderedBlock {
  return {
    name: 'questions',
    heading: '## Open questions',
    body: e.questions.length ? e.questions.map((q) => `- ${q}`).join('\n') : NONE,
  };
}

function ownerOf(
  ctx: RenderContext,
  e: EntityRecord,
  predicate: 'owner' | 'assignee' = 'owner',
): EntityRecord | undefined {
  const l = liveLinks(e, predicate)[0] ?? e.links.find((x) => x.predicate === predicate);
  return l ? ctx.entities.get(l.target) : undefined;
}

function parentsOf(
  ctx: RenderContext,
  e: EntityRecord,
  predicate: 'part_of' | 'blocks' = 'part_of',
): EntityRecord[] {
  return liveLinks(e, predicate)
    .map((l) => ctx.entities.get(l.target))
    .filter((x): x is EntityRecord => x !== undefined);
}

function sourceCount(e: EntityRecord): number {
  return e.sources.length;
}

function base(e: EntityRecord, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    type: e.type,
    cubbon_id: e.id,
    aliases: e.aliases,
    ...extra,
    first_seen: e.firstSeen,
    last_seen: e.lastSeen,
    sources: sourceCount(e),
    retired: e.retired ? true : undefined,
  };
}

function targetWas(e: EntityRecord): string | undefined {
  const list = (e.dates.target ?? []).filter((d) => !d.superseded);
  const current = currentDate(e, 'target');
  const previous = list.filter((d) => d !== current);
  const last = previous[previous.length - 1];
  return last && current && last.date !== current.date
    ? fmtDate(last.date, last.precision)
    : undefined;
}

export function renderEntity(e: EntityRecord, ctx: RenderContext): RenderedNote {
  switch (e.type) {
    case 'project':
      return renderProject(e, ctx);
    case 'milestone':
      return renderMilestone(e, ctx);
    case 'blocker':
      return renderBlocker(e, ctx);
    case 'decision':
      return renderDecision(e, ctx);
    case 'commitment':
      return renderCommitment(e, ctx);
    case 'person':
      return renderPerson(e, ctx);
    case 'organization':
      return renderOrganization(e, ctx);
    case 'external':
      return renderExternal(e, ctx);
    default:
      throw new Error(`no renderer for ${e.type}`);
  }
}

function notePath(e: EntityRecord): string {
  return `${FOLDER[e.type]}/${e.fileName}.md`;
}

function milestoneLine(m: EntityRecord): string {
  const target = currentDate(m, 'target');
  const was = targetWas(m);
  const status = currentStatus(m);
  const parts = [link(m.fileName, m.name)];
  if (target) parts.push(`${fmtDate(target.date, target.precision)}${was ? ` (was ${was})` : ''}`);
  if (status) parts.push(status.status);
  return `- ${parts.join(' · ')}${m.retired ? ' · retired' : ''}`;
}

function blockerLine(ctx: RenderContext, b: EntityRecord): string {
  const resolved = currentDate(b, 'resolved');
  const owner = ownerOf(ctx, b);
  const parts = [link(b.fileName, b.name)];
  parts.push(
    resolved
      ? `resolved ${fmtDate(resolved.date, resolved.precision)}`
      : `open since ${b.firstSeen}`,
  );
  if (owner) parts.push(`owner ${link(owner.fileName, owner.name)}`);
  return `- ${parts.join(' · ')}${b.retired ? ' · retired' : ''}`;
}

function commitmentLine(
  ctx: RenderContext,
  c: EntityRecord,
  opts: { withProject?: boolean; omit?: string } = {},
): string {
  const done = currentDate(c, 'done');
  const due = currentDate(c, 'due');
  const assignee = ownerOf(ctx, c, 'assignee');
  const parts = [link(c.fileName, c.name)];
  if (assignee && assignee.id !== opts.omit) parts.push(link(assignee.fileName, assignee.name));
  if (due)
    parts.push(
      `due ${fmtDate(due.date, due.precision)}${!done && due.date < ctx.asOf ? ' (overdue)' : ''}`,
    );
  if (done) parts.push(`done ${fmtDate(done.date, done.precision)}`);
  if (opts.withProject) {
    const projects = parentsOf(ctx, c);
    if (projects.length) parts.push(projects.map((p) => link(p.fileName, p.name)).join(', '));
  }
  const p =
    (c.dates.due?.[0] ?? c.dates.done?.[0])?.claims[0] ?? liveLinks(c, 'assignee')[0]?.claims[0];
  if (p) parts.push(src(ctx, p));
  return `- [${done ? 'x' : ' '}] ${parts.join(' · ')}${c.retired ? ' · retired' : ''}`;
}

function decisionLine(d: EntityRecord): string {
  const text = bestText(d, 'decided');
  const date = text?.claims[0]?.validFrom ?? d.firstSeen;
  const parts = [date, link(d.fileName, d.name)];
  if (text) parts.push(oneLine(text.text));
  return `- ${parts.join(' · ')}${d.retired ? ' · retired' : ''}`;
}

function childrenOf(
  ctx: RenderContext,
  e: EntityRecord,
  type: EntityType,
  predicates: LinkEntry['predicate'][],
): EntityRecord[] {
  const list = (ctx.incoming.get(e.id) ?? [])
    .filter(
      (i) => i.from.type === type && predicates.includes(i.link.predicate) && !i.link.superseded,
    )
    .map((i) => i.from);
  return [...new Map(list.map((x) => [x.id, x])).values()];
}

function renderProject(e: EntityRecord, ctx: RenderContext): RenderedNote {
  const status = currentStatus(e);
  const owner = ownerOf(ctx, e);
  const target = currentDate(e, 'target');
  const team = bestText(e, 'team');
  const milestones = childrenOf(ctx, e, 'milestone', ['part_of']).sort((a, b) => {
    const ad = currentDate(a, 'target')?.date ?? '9999';
    const bd = currentDate(b, 'target')?.date ?? '9999';
    return ad.localeCompare(bd) || a.name.localeCompare(b.name);
  });
  const blockers = childrenOf(ctx, e, 'blocker', ['blocks', 'part_of']);
  const commitments = childrenOf(ctx, e, 'commitment', ['part_of']).sort((a, b) => {
    const ad = currentDate(a, 'done') ? 1 : 0;
    const bd = currentDate(b, 'done') ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return (
      (currentDate(a, 'due')?.date ?? '9999').localeCompare(
        currentDate(b, 'due')?.date ?? '9999',
      ) || a.name.localeCompare(b.name)
    );
  });
  const decisions = childrenOf(ctx, e, 'decision', ['part_of']);
  const linkLines: string[] = [];
  for (const l of liveLinks(e, 'depends_on'))
    linkLines.push(`- depends on ${entityLink(ctx, l.target)} · ${src(ctx, l.claims[0])}`);
  for (const i of ctx.incoming.get(e.id) ?? []) {
    if (i.link.predicate === 'depends_on' && !i.link.superseded && i.from.type === 'project') {
      linkLines.push(`- ${link(i.from.fileName, i.from.name)} depends on this`);
    }
  }
  if (owner) {
    for (const i of ctx.incoming.get(owner.id) ?? []) {
      if (
        i.link.predicate === 'owner' &&
        !i.link.superseded &&
        i.from.type === 'project' &&
        i.from.id !== e.id
      ) {
        linkLines.push(`- shares owner with ${link(i.from.fileName, i.from.name)}`);
      }
    }
  }
  for (const l of liveLinks(e, 'member')) linkLines.push(`- member ${entityLink(ctx, l.target)}`);
  for (const l of liveLinks(e, 'references'))
    linkLines.push(`- references ${entityLink(ctx, l.target)}`);
  const blocks: RenderedBlock[] = [
    summaryBlock(e),
    {
      name: 'status',
      heading: '## Status log',
      body: e.statusLog.length ? e.statusLog.map((s) => statusLine(ctx, s)).join('\n') : NONE,
    },
    {
      name: 'dates',
      heading: '## Target date history',
      body: (e.dates.target ?? []).length
        ? (e.dates.target ?? []).map((d) => dateLine(ctx, d, 'target')).join('\n')
        : NONE,
    },
    {
      name: 'milestones',
      heading: '## Milestones',
      body: milestones.length ? milestones.map((m) => milestoneLine(m)).join('\n') : NONE,
    },
    {
      name: 'blockers',
      heading: '## Blockers',
      body: blockers.length ? blockers.map((b) => blockerLine(ctx, b)).join('\n') : NONE,
    },
    {
      name: 'commitments',
      heading: '## Commitments',
      body: commitments.length ? commitments.map((c) => commitmentLine(ctx, c)).join('\n') : NONE,
    },
    {
      name: 'decisions',
      heading: '## Decisions',
      body: decisions.length ? decisions.map((d) => decisionLine(d)).join('\n') : NONE,
    },
    {
      name: 'links',
      heading: '## Dependencies and links',
      body: linkLines.length ? linkLines.sort().join('\n') : NONE,
    },
    questionsBlock(e),
  ];
  return {
    path: notePath(e),
    title: e.name,
    frontmatter: base(e, {
      status: status?.status,
      status_since: status?.date,
      owner: owner ? link(owner.fileName) : undefined,
      team: team ? oneLine(team.text) : undefined,
      target: target ? fmtDate(target.date, target.precision) : undefined,
      target_was: targetWas(e),
    }),
    blocks,
    notesHint:
      'Anything written outside the generated blocks is yours and is never touched by Cubbon.',
  };
}

function renderMilestone(e: EntityRecord, ctx: RenderContext): RenderedNote {
  const status = currentStatus(e);
  const owner = ownerOf(ctx, e);
  const target = currentDate(e, 'target');
  const projects = parentsOf(ctx, e);
  const blockers = childrenOf(ctx, e, 'blocker', ['blocks', 'part_of']);
  return {
    path: notePath(e),
    title: e.name,
    frontmatter: base(e, {
      project: projects[0] ? link(projects[0].fileName) : undefined,
      status: status?.status,
      status_since: status?.date,
      owner: owner ? link(owner.fileName) : undefined,
      target: target ? fmtDate(target.date, target.precision) : undefined,
      target_was: targetWas(e),
    }),
    blocks: [
      summaryBlock(e),
      {
        name: 'dates',
        heading: '## Target date history',
        body: (e.dates.target ?? []).length
          ? (e.dates.target ?? []).map((d) => dateLine(ctx, d, 'target')).join('\n')
          : NONE,
      },
      {
        name: 'status',
        heading: '## Status log',
        body: e.statusLog.length ? e.statusLog.map((s) => statusLine(ctx, s)).join('\n') : NONE,
      },
      {
        name: 'blockers',
        heading: '## Blockers',
        body: blockers.length ? blockers.map((b) => blockerLine(ctx, b)).join('\n') : NONE,
      },
      questionsBlock(e),
    ],
  };
}

function renderBlocker(e: EntityRecord, ctx: RenderContext): RenderedNote {
  const resolved = currentDate(e, 'resolved');
  const owner = ownerOf(ctx, e);
  const blocked = [...parentsOf(ctx, e, 'blocks'), ...parentsOf(ctx, e, 'part_of')];
  const uniqueBlocked = [...new Map(blocked.map((b) => [b.id, b])).values()];
  const details: string[] = [];
  for (const b of uniqueBlocked) {
    const l = e.links.find(
      (x) => x.target === b.id && (x.predicate === 'blocks' || x.predicate === 'part_of'),
    );
    details.push(
      `- blocks ${link(b.fileName, b.name)} · since ${l?.claims[0]?.validFrom ?? e.firstSeen} · ${src(ctx, l?.claims[0])}`,
    );
  }
  for (const d of e.dates.resolved ?? []) details.push(dateLine(ctx, d, 'resolved'));
  return {
    path: notePath(e),
    title: e.name,
    frontmatter: base(e, {
      status: resolved ? 'resolved' : 'open',
      opened: e.firstSeen,
      resolved: resolved ? fmtDate(resolved.date, resolved.precision) : undefined,
      owner: owner ? link(owner.fileName) : undefined,
      blocks: uniqueBlocked.map((b) => link(b.fileName)),
    }),
    blocks: [
      summaryBlock(e),
      { name: 'details', heading: '## Details', body: details.length ? details.join('\n') : NONE },
      questionsBlock(e),
    ],
  };
}

function renderDecision(e: EntityRecord, ctx: RenderContext): RenderedNote {
  const text = bestText(e, 'decided');
  const projects = parentsOf(ctx, e);
  const date = text?.claims[0]?.validFrom ?? e.firstSeen;
  const body = (e.texts.decided ?? []).map(
    (t) => `- ${oneLine(t.text)} · ${src(ctx, t.claims[0])}${supersededSuffix(t)}`,
  );
  return {
    path: notePath(e),
    title: e.name,
    frontmatter: base(e, {
      date,
      projects: projects.map((p) => link(p.fileName)),
    }),
    blocks: [
      summaryBlock(e),
      { name: 'decision', heading: '## Decision', body: body.length ? body.join('\n') : NONE },
      {
        name: 'links',
        heading: '## Affects',
        body: projects.length
          ? projects.map((p) => `- ${link(p.fileName, p.name)}`).join('\n')
          : NONE,
      },
      questionsBlock(e),
    ],
  };
}

function renderCommitment(e: EntityRecord, ctx: RenderContext): RenderedNote {
  const done = currentDate(e, 'done');
  const due = currentDate(e, 'due');
  const assignee = ownerOf(ctx, e, 'assignee');
  const projects = parentsOf(ctx, e);
  const status = done ? 'done' : due && due.date < ctx.asOf ? 'overdue' : 'open';
  const details: string[] = [];
  for (const d of e.dates.due ?? []) details.push(dateLine(ctx, d, 'due'));
  for (const d of e.dates.done ?? []) details.push(dateLine(ctx, d, 'done'));
  for (const l of liveLinks(e, 'references'))
    details.push(`- references ${entityLink(ctx, l.target)}`);
  return {
    path: notePath(e),
    title: e.name,
    frontmatter: base(e, {
      status,
      assignee: assignee ? link(assignee.fileName) : undefined,
      opened: e.firstSeen,
      due: due ? fmtDate(due.date, due.precision) : undefined,
      done: done ? fmtDate(done.date, done.precision) : undefined,
      project: projects[0] ? link(projects[0].fileName) : undefined,
    }),
    blocks: [
      summaryBlock(e),
      { name: 'details', heading: '## Details', body: details.length ? details.join('\n') : NONE },
      questionsBlock(e),
    ],
  };
}

function renderPerson(e: EntityRecord, ctx: RenderContext): RenderedNote {
  const role = bestText(e, 'role');
  const org = liveLinks(e, 'affiliation')[0];
  const orgEntity = org ? ctx.entities.get(org.target) : undefined;
  const owns = (ctx.incoming.get(e.id) ?? []).filter(
    (i) => i.link.predicate === 'owner' && !i.link.superseded,
  );
  const member = (ctx.incoming.get(e.id) ?? []).filter(
    (i) => i.link.predicate === 'member' && !i.link.superseded,
  );
  const commitments = (ctx.incoming.get(e.id) ?? [])
    .filter((i) => i.link.predicate === 'assignee' && !i.link.superseded)
    .map((i) => i.from);
  const email = [e.name, ...e.aliases].find((a) => a.includes('@'));
  return {
    path: notePath(e),
    title: e.name,
    frontmatter: base(e, {
      role: role ? oneLine(role.text) : undefined,
      organization: orgEntity ? link(orgEntity.fileName) : undefined,
      email,
    }),
    blocks: [
      summaryBlock(e),
      {
        name: 'owns',
        heading: '## Owns',
        body: owns.length
          ? owns.map((i) => `- ${link(i.from.fileName, i.from.name)} (${i.from.type})`).join('\n')
          : NONE,
      },
      {
        name: 'member',
        heading: '## Member of',
        body: member.length
          ? member.map((i) => `- ${link(i.from.fileName, i.from.name)}`).join('\n')
          : NONE,
      },
      {
        name: 'commitments',
        heading: '## Commitments',
        body: commitments.length
          ? commitments
              .map((c) => commitmentLine(ctx, c, { withProject: true, omit: e.id }))
              .join('\n')
          : NONE,
      },
      questionsBlock(e),
    ],
  };
}

function renderOrganization(e: EntityRecord, ctx: RenderContext): RenderedNote {
  const people = (ctx.incoming.get(e.id) ?? []).filter(
    (i) => i.link.predicate === 'affiliation' && !i.link.superseded,
  );
  return {
    path: notePath(e),
    title: e.name,
    frontmatter: base(e, {}),
    blocks: [
      summaryBlock(e),
      {
        name: 'people',
        heading: '## People',
        body: people.length
          ? people.map((i) => `- ${link(i.from.fileName, i.from.name)}`).join('\n')
          : NONE,
      },
      questionsBlock(e),
    ],
  };
}

function renderExternal(e: EntityRecord, ctx: RenderContext): RenderedNote {
  const kind = externalKind(e.name);
  const key = externalKey(e.name);
  const refs = (ctx.incoming.get(e.id) ?? []).filter(
    (i) => i.link.predicate === 'references' && !i.link.superseded,
  );
  return {
    path: notePath(e),
    title: e.name,
    frontmatter: base(e, {
      kind,
      key: key?.startsWith('ticket:') ? key.slice(7) : undefined,
      url: key?.startsWith('url:') ? e.name : undefined,
    }),
    blocks: [
      summaryBlock(e),
      {
        name: 'refs',
        heading: '## Referenced by',
        body: refs.length
          ? refs.map((i) => `- ${link(i.from.fileName, i.from.name)} (${i.from.type})`).join('\n')
          : NONE,
      },
      questionsBlock(e),
    ],
  };
}
