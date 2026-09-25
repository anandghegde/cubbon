# ADR-002 Canonical state is files, SQLite is an index

Status: accepted (week 0, 2026-09-25)

## Decision

- Claims are stored as JSONL, one file per source content hash, under `.cubbon/claims/<hh>/<hash>.jsonl`, with extraction side outputs (entities, unresolved dates, drops) in `<hash>.meta.json`.
- Entity records live under `.cubbon/entities/<type>/<id>.json`.
- `.cubbon/state.db` indexes sources, claims, runs, LLM calls and later entities, aliases, jobs and review items. It can be deleted and rebuilt from the files.
- The Markdown vault is rendered from entity records plus preserved human sections and is the user-facing truth.

## Consequences

- Every write goes to the file first, then to the index, so a crash never leaves the index ahead of the files.
- Claims are never deleted. A claim that disappears on re-extraction gets `supersededAt`; a hash that no path holds any more has all of its claims superseded.
