# ADR-006 Review round trip through a Markdown checklist

Status: accepted (week 0, 2026-09-25)

## Decision

`review.md` in the vault is the only review interface in v1. Each item is a checklist line carrying a hidden id in an HTML comment. Checking a line confirms, editing the text corrects, deleting the line rejects. Answers are read at the start of the next compile and persisted so an item is never asked twice.

## Consequences

- No UI code before M4; the Obsidian plugin renders the same file later.
- The rendered text of each item is stored so edits can be diffed against it.
