import type { Provider, Usage } from '../llm/types.ts';
import { predicateSpec } from '../model/ontology.ts';
import type {
  Claim,
  DocDate,
  ISODateTime,
  OwnerIdentity,
  SourceType,
  Span,
} from '../model/types.ts';
import type { Chunk } from '../parse/chunk.ts';
import { isValidISODate } from '../util/text.ts';
import { claimId } from './ids.ts';
import { buildUserMessage } from './prompt.ts';
import { type ExtractedClaim, type ExtractedEntity, ExtractionOutputSchema } from './schema.ts';
import { locateEvidence } from './span.ts';

export interface ExtractSource {
  hash: string;
  path: string;
  type: SourceType;
  title: string | null;
  docDate: DocDate;
  authority: number;
}

export interface ExtractParams {
  provider: Provider;
  systemPrompt: string;
  extractorVersion: string;
  source: ExtractSource;
  owner: OwnerIdentity;
  chunk: Chunk;
  chunkCount: number;
  ingestedAt: ISODateTime;
}

export interface DroppedClaim {
  reason: string;
  claim: ExtractedClaim;
}

export interface ExtractResult {
  claims: Claim[];
  entities: ExtractedEntity[];
  unresolvedDates: { text: string; evidence: string; reason: string }[];
  openQuestions: string[];
  dropped: DroppedClaim[];
  usage: Usage;
  costUsd: number | null;
  model: string;
  fromCassette: boolean;
}

/** One model call for one chunk, then deterministic post-processing into stored claims. */
export async function extractChunk(p: ExtractParams): Promise<ExtractResult> {
  const res = await p.provider.complete({
    purpose: 'extract',
    system: p.systemPrompt,
    user: buildUserMessage({
      filePath: p.source.path,
      title: p.source.title,
      sourceType: p.source.type,
      docDate: p.source.docDate,
      chunk: p.chunk,
      chunkCount: p.chunkCount,
    }),
    schema: ExtractionOutputSchema,
    schemaName: 'record_extraction',
    schemaDescription: 'Record the entities and claims found in the chunk.',
  });

  const claims = new Map<string, Claim>();
  const dropped: DroppedClaim[] = [];
  for (const raw of res.data.claims) {
    const reason = validate(raw);
    if (reason) {
      dropped.push({ reason, claim: raw });
      continue;
    }
    const local = locateEvidence(p.chunk.text, raw.evidence);
    const span: Span = local
      ? { start: p.chunk.start + local.start, end: p.chunk.start + local.end, exact: local.exact }
      : { start: p.chunk.start, end: p.chunk.end, exact: false };
    const validFrom =
      raw.valid_from && isValidISODate(raw.valid_from) ? raw.valid_from : p.source.docDate.date;
    const id = claimId(p.source.hash, span, raw.subject, raw.predicate, raw.object);
    if (claims.has(id)) continue;
    const claim: Claim = {
      id,
      subject: { type: raw.subject.type, name: raw.subject.name.trim() },
      predicate: raw.predicate,
      object: raw.object,
      validFrom,
      recordedAt: p.source.docDate.date,
      ingestedAt: p.ingestedAt,
      sourceHash: p.source.hash,
      sourcePath: p.source.path,
      span,
      evidence: raw.evidence,
      confidence: local ? raw.confidence : Math.min(raw.confidence, 0.5),
      authority: p.source.authority,
      extractorVersion: p.extractorVersion,
      model: res.model,
    };
    if (raw.valid_to && isValidISODate(raw.valid_to)) claim.validTo = raw.valid_to;
    claims.set(id, claim);
  }

  const ordered = [...claims.values()].sort(
    (a, b) =>
      a.span.start - b.span.start ||
      a.predicate.localeCompare(b.predicate) ||
      a.id.localeCompare(b.id),
  );
  return {
    claims: ordered,
    entities: res.data.entities,
    unresolvedDates: res.data.unresolved_dates,
    openQuestions: res.data.open_questions,
    dropped,
    usage: res.usage,
    costUsd: res.costUsd,
    model: res.model,
    fromCassette: res.fromCassette,
  };
}

function validate(c: ExtractedClaim): string | null {
  const spec = predicateSpec(c.predicate);
  if (!spec.subject.includes(c.subject.type)) {
    return `subject type ${c.subject.type} not allowed for ${c.predicate}`;
  }
  if (c.object.kind !== spec.object) {
    return `object kind ${c.object.kind} does not match ${c.predicate} (${spec.object})`;
  }
  if (
    c.object.kind === 'entity' &&
    spec.objectEntity &&
    !spec.objectEntity.includes(c.object.type)
  ) {
    return `object entity type ${c.object.type} not allowed for ${c.predicate}`;
  }
  if (c.object.kind === 'date' && !isValidISODate(c.object.value)) {
    return `invalid date ${c.object.value}`;
  }
  if (c.subject.name.trim().length === 0) return 'empty subject name';
  return null;
}
