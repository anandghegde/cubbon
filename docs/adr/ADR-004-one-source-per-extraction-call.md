# ADR-004 One source file per extraction call

Status: accepted (week 0, 2026-09-25)

## Decision

An extraction prompt contains exactly one document, or one chunk of one document, wrapped in `<chunk>` tags with the file path, title, source type and document date. Batching happens at the job level with a concurrency limit, never inside a prompt.

## Consequences

- Entities cannot bleed between documents in one response.
- Claim ids are scoped by source hash and span, so re-extracting an unchanged file yields identical claims.
- Cost is one call per chunk; the default chunk size (24,000 characters) keeps most work documents to one call.
