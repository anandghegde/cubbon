import type { MergeResult } from '../merge/merge.ts';
import type { Claim } from '../model/types.ts';
import type { SourceRow } from '../state/db.ts';
import { contractHome } from '../util/paths.ts';
import { FOLDER, type RenderContext } from './entities.ts';
import { fmtDate, link, quote } from './format.ts';
import type { RenderedNote } from './note.ts';

export interface SourceNoteInput {
  row: SourceRow;
  fileName: string;
  id: string;
  /** Claims for every hash this path has had, newest hash first. */
  claims: Claim[];
}

export function describeObject(ctx: RenderContext, merge: MergeResult, c: Claim): string {
  switch (c.object.kind) {
    case 'status':
      return `**${c.object.value}**`;
    case 'date':
      return fmtDate(c.object.value, c.object.precision ?? 'day');
    case 'text':
      return quote(c.object.value, 100);
    case 'entity': {
      const id = merge.claimObjects.get(c.id);
      const e = id ? ctx.entities.get(id) : undefined;
      return e ? link(e.fileName, e.name) : c.object.name;
    }
  }
}

export function subjectLink(ctx: RenderContext, merge: MergeResult, c: Claim): string {
  const id = merge.claimSubjects.get(c.id);
  const e = id ? ctx.entities.get(id) : undefined;
  return e ? link(e.fileName, e.name) : c.subject.name;
}

function claimLine(ctx: RenderContext, merge: MergeResult, c: Claim): string {
  const parts = [
    c.validFrom,
    subjectLink(ctx, merge, c),
    `${c.predicate} → ${describeObject(ctx, merge, c)}`,
    quote(c.evidence),
    c.confidence.toFixed(2),
    `chars ${c.span.start}–${c.span.end}${c.span.exact ? '' : ' (approx.)'}`,
  ];
  return `- ${parts.join(' · ')}`;
}

/** One note per ingested document, listing every claim with its span (PRD FR5.5). */
export function renderSource(
  input: SourceNoteInput,
  ctx: RenderContext,
  merge: MergeResult,
): RenderedNote {
  const { row } = input;
  const live = input.claims.filter((c) => c.supersededAt === undefined).sort(claimSort);
  const old = input.claims.filter((c) => c.supersededAt !== undefined).sort(claimSort);
  const lines = live.map((c) => claimLine(ctx, merge, c));
  if (old.length) {
    lines.push('', '### Superseded', ...old.map((c) => claimLine(ctx, merge, c)));
  }
  return {
    path: `${FOLDER.source}/${input.fileName}.md`,
    title: row.title ?? input.fileName,
    frontmatter: {
      type: 'source',
      cubbon_id: input.id,
      source_type: row.sourceType,
      doc_date: row.docDate?.date,
      doc_date_method: row.docDate?.method,
      path: contractHome(row.path),
      hash: row.hash,
      claims: live.length,
      extractor: row.extractorVersion ?? undefined,
    },
    blocks: [
      {
        name: 'claims',
        heading: '## Claims',
        body: lines.length ? lines.join('\n') : '_No claims extracted._',
      },
    ],
  };
}

function claimSort(a: Claim, b: Claim): number {
  return (
    a.span.start - b.span.start ||
    a.predicate.localeCompare(b.predicate) ||
    a.id.localeCompare(b.id)
  );
}
