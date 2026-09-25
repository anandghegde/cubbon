# ADR-001 Language and runtime: TypeScript on Bun

Status: accepted (week 0, 2026-09-25)

## Decision

Cubbon is written in TypeScript and runs on Bun 1.4. The pipeline, the daemon, the MCP server and the later Obsidian plugin share one language. Bun supplies the SQLite driver (`bun:sqlite`), the test runner (`bun test`), the bundler and single-file executables (`bun build --compile`).

## Verified in week 0

- `bun build --compile` produces `dist/cubbon` (about 60 MB) with the prompt Markdown embedded via `import ... with { type: 'text' }`. The extractor version computed inside the binary matches the source run.
- `@parcel/watcher` 2.6 subscribes and reports create and delete events under Bun on macOS.
- `bun:sqlite` handles WAL mode, transactions and `PRAGMA user_version` migrations.

## Consequences

- Node stays a fallback target: no Bun-only API is used outside `state/db.ts` (SQLite) and the build script. A Node port would swap `bun:sqlite` for `better-sqlite3`.
- The compiled binary must be checked again once the daemon links the native watcher module (M3).
