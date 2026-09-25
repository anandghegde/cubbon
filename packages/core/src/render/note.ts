export interface RenderedBlock {
  name: string;
  /** Heading written above the block when the note is first created. */
  heading?: string;
  body: string;
}

export interface RenderedNote {
  /** Path relative to the vault root, including .md. */
  path: string;
  /** Frontmatter keys in order. Keys not listed here are left to the user. */
  frontmatter: Record<string, unknown>;
  title: string;
  blocks: RenderedBlock[];
  /** Text placed under the Notes heading when the note is first created. */
  notesHint?: string;
}

/** Frontmatter keys Cubbon owns on every note type. Anything else is preserved verbatim. */
export const MANAGED_KEYS = new Set([
  'type',
  'cubbon_id',
  'aliases',
  'status',
  'status_since',
  'owner',
  'assignee',
  'team',
  'target',
  'target_was',
  'opened',
  'resolved',
  'due',
  'done',
  'date',
  'project',
  'projects',
  'blocks',
  'decided_by',
  'kind',
  'key',
  'url',
  'organization',
  'role',
  'email',
  'source_type',
  'doc_date',
  'doc_date_method',
  'path',
  'hash',
  'authority',
  'claims',
  'extractor',
  'first_seen',
  'last_seen',
  'sources',
  'retired',
  'questions',
]);
