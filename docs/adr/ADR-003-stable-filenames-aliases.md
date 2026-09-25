# ADR-003 Stable filenames, aliases instead of renames

Status: accepted (week 0, 2026-09-25)

## Decision

A note's filename is fixed when the entity is first emitted and recorded on the entity record (`fileName`). When the canonical name changes, the new name is added to the note's `aliases` frontmatter, which Obsidian resolves in wikilinks. Cubbon never renames files or rewrites links across the vault. Filename collisions across the whole vault get a numeric suffix.

## Consequences

- The filename allocator is deterministic given the order entities are first seen, and the golden determinism test relies on that.
- Wikilinks are emitted by filename without a folder prefix wherever possible, so they keep resolving if the user moves notes.
