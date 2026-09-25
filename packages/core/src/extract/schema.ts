import { z } from 'zod';
import { EXTRACTABLE_ENTITY_TYPES, PREDICATES, PROJECT_STATUSES } from '../model/types.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const EntityRefSchema = z.object({
  type: z.enum(EXTRACTABLE_ENTITY_TYPES),
  name: z.string().min(1).describe('The fullest name used in the document for this entity.'),
});

export const ClaimObjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), value: z.enum(PROJECT_STATUSES) }),
  z.object({
    kind: z.literal('date'),
    value: z
      .string()
      .regex(ISO_DATE)
      .describe(
        'YYYY-MM-DD. For month, quarter or year precision use the first day of the period.',
      ),
    precision: z.enum(['day', 'month', 'quarter', 'year']),
  }),
  z.object({ kind: z.literal('text'), value: z.string().min(1) }),
  z.object({
    kind: z.literal('entity'),
    type: z.enum(EXTRACTABLE_ENTITY_TYPES),
    name: z.string().min(1),
  }),
]);

export const ExtractedClaimSchema = z.object({
  subject: EntityRefSchema,
  predicate: z.enum(PREDICATES),
  object: ClaimObjectSchema,
  valid_from: z
    .string()
    .regex(ISO_DATE)
    .nullable()
    .describe(
      'Date the fact became true, resolved against the document date. Null when the fact is simply stated as of the document date or the date cannot be resolved.',
    ),
  valid_to: z
    .string()
    .regex(ISO_DATE)
    .nullable()
    .describe('Date the fact stopped being true, if the document says so. Usually null.'),
  evidence: z
    .string()
    .min(1)
    .max(600)
    .describe('Verbatim excerpt from the chunk, up to 300 characters, that supports the claim.'),
  confidence: z.number().min(0).max(1),
});
export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

export const ExtractedEntitySchema = z.object({
  type: z.enum(EXTRACTABLE_ENTITY_TYPES),
  name: z.string().min(1),
  aliases: z.array(z.string()).describe('Other names used for this entity in the chunk.'),
  description: z.string().nullable().describe('One sentence, only when the chunk gives one.'),
});
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

export const ExtractionOutputSchema = z.object({
  entities: z.array(ExtractedEntitySchema),
  claims: z.array(ExtractedClaimSchema),
  unresolved_dates: z.array(
    z.object({
      text: z.string().describe('The date expression as written.'),
      evidence: z.string().describe('Verbatim excerpt containing it.'),
      reason: z.string(),
    }),
  ),
  open_questions: z
    .array(z.string())
    .describe('Ambiguities a human should resolve: unclear ownership, conflicting statements.'),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
