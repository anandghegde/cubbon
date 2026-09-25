import type { ClaimObject, EntityRef } from '../model/types.ts';
import { shortHash } from '../util/hash.ts';
import { normalizeText } from '../util/text.ts';

/** Version of the post-processing code. Bump when the meaning of stored claims changes. */
export const CODE_VERSION = '0.1.0';

export function normalizeObject(o: ClaimObject): string {
  switch (o.kind) {
    case 'status':
      return `status:${o.value}`;
    case 'date':
      return `date:${o.value}`;
    case 'text':
      return `text:${normalizeText(o.value)}`;
    case 'entity':
      return `entity:${o.type}:${normalizeText(o.name)}`;
  }
}

/** Deterministic claim id: the same source, span, subject, predicate and object always hash alike. */
export function claimId(
  sourceHash: string,
  span: { start: number; end: number },
  subject: EntityRef,
  predicate: string,
  object: ClaimObject,
): string {
  const key = [
    sourceHash,
    span.start,
    span.end,
    subject.type,
    normalizeText(subject.name),
    predicate,
    normalizeObject(object),
  ].join('|');
  return `clm_${shortHash(key, 16)}`;
}

export function extractorVersion(promptText: string, schemaJson: string): string {
  return shortHash(`${promptText}\n${schemaJson}\n${CODE_VERSION}`, 8);
}
