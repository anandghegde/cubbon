# Cubbon: Implementation Plan

| | |
|---|---|
| Status | Draft v0.1 |
| Date | 2026-09-25 |
| Companion | PRD.md (requirements, FR and NFR ids referenced below) |
| Team assumed | Two engineers (Eng A: pipeline and models, Eng B: vault, daemon, Obsidian) |
| Horizon | 16 weeks to v1.0, matching PRD milestones M0 to M4 |

---

## 1. Technical decisions

Each decision gets an Architecture Decision Record in `docs/adr/` during week 0. The decisions below are the defaults to start from.

### ADR-001 Language and runtime: TypeScript on Bun

- One language for the pipeline, the daemon, the MCP server and the Obsidian plugin (which must be TypeScript).
- Bun provides a built-in SQLite driver, test runner, bundler and single-file executable output, which covers the packaging requirement without extra tooling.
- The official MCP SDK and the Anthropic SDK are first-class in TypeScript, with structured outputs.
- Rowboat is a TypeScript codebase with hard-won patterns (one file per extraction run, owner identity block, mtime plus hash state) that can be read directly.
- Risk: native module compatibility under Bun. Fallback is Node 22 with tsx and esbuild, and the code is written to run on both. Week 0 spike confirms the watcher and SQLite paths.

### ADR-002 Canonical state is files, SQLite is an index

- Claims live in `.cubbon/claims/<source-hash>.jsonl`, one line per claim. Entity records live in `.cubbon/entities/<type>/<id>.json`. Both are plain files, diffable, and committed to the vault's git history.
- SQLite at `.cubbon/state.db` indexes sources, claims, entities, aliases, jobs and review items for fast queries. It can be deleted and rebuilt from the files at any time (`cubbon doctor --rebuild-index`).
- The Markdown vault is rendered from entity records plus preserved human sections. It is the user-facing truth and works standalone in Obsidian.

### ADR-003 Stable filenames, aliases instead of renames

- A note's filename is fixed when the entity is first emitted. If the canonical name changes later, the new name is added to the note's `aliases` frontmatter, which Obsidian resolves in wikilinks. Cubbon never renames files or rewrites links across the vault.

### ADR-004 One source file per extraction call

- Extraction prompts contain exactly one document (or one chunk of one document). Batching is done at the job level, never inside a prompt. This is the single most effective guard against entities bleeding between documents.

### ADR-005 Provider abstraction with recorded cassettes

- A `Provider` interface with `complete(structured)` implemented for Anthropic and Ollama. Every call can be recorded to a cassette file keyed by a hash of the prompt and schema. Tests replay cassettes; a nightly job runs live against the golden set with a spend cap.

### ADR-006 Review round trip through a Markdown checklist

- `review.md` is the only review interface in v1. Each item carries a hidden id in an HTML comment. Checking, editing or deleting a line is the answer. The Obsidian plugin in M4 renders the same file; it does not add a second channel.

### Libraries

| Concern | Choice | Notes |
|---|---|---|
| CLI | commander | |
| File events | @parcel/watcher, fallback fs.watch | Verify under Bun in week 0 |
| Hashing | Bun.hash or node crypto sha256 | Content hash is sha256, truncated to 16 hex for ids |
| Markdown | unified, remark-parse, remark-frontmatter, remark-gfm, mdast utilities | Parse only; emission is string rendering for full control |
| Frontmatter | gray-matter or the remark-frontmatter node | |
| YAML | yaml | Bases files, config, aliases |
| Schemas | zod, zod-to-json-schema | Claim schema, config schema, MCP tool schemas |
| LLM | @anthropic-ai/sdk, plain fetch for Ollama | Structured outputs via tool use with JSON schema |
| MCP | @modelcontextprotocol/sdk | stdio and streamable HTTP |
| SQLite | bun:sqlite, better-sqlite3 as Node fallback | |
| Logging | pino | JSON logs to `.cubbon/logs/` |
| Keychain | @napi-rs/keyring, env var fallback | |
| Git | simple-git or shelling out | Vault history |
| Tests | bun test, fast-check for property tests | |
| Lint and format | biome | |

Versions are pinned in week 0 after the spike.

## 2. Repository layout

```
cubbon/
  PRD.md
  IMPLEMENTATION_PLAN.md
  docs/adr/                      decision records
  package.json                   bun workspaces
  packages/
    core/                        the pipeline library
      src/
        config/                  vault and global config, keychain
        fs/                      watcher, hashing, raw store, path rules
        triage/                  work-or-not, source type detection
        parse/                   markdown, frontmatter, doc date, chunking, source pre-processors
        llm/                     provider interface, anthropic, ollama, cassettes, cost
        extract/                 prompt assembly, claim schema, claim ids, extractor version
        merge/                   alias table, resolution, status log, dates, conflicts, commitments
        model/                   domain types, entity and claim persistence, sqlite index
        emit/                    renderers, block-preserving writer, bases, days, digest, canvas, obsidian config, git
        review/                  queue writer, answer parser, feedback application
        lint/                    checks
        pipeline/                orchestrator, job queue, journal, run records, compile log
        api/                     local http for status and the plugin
    prompts/                     prompt markdown files and schemas, versioned
    cli/                         commander entry, daemon, launchd and systemd installers
    mcp/                         mcp server
    obsidian-plugin/             M4
    eval/                        golden runner, metrics, cassette tooling
  fixtures/
    golden/                      documents, expected claims, expected vault snapshot
    exports/                     sample email, chat, ticket and meeting export shapes
  .github/workflows/             ci, nightly eval, release
```

## 3. Core design

### 3.1 Domain types

```ts
type EntityType = 'project' | 'milestone' | 'blocker' | 'decision' | 'commitment'
               | 'person' | 'organization' | 'external' | 'source';

interface Claim {
  id: string;                 // sha256(sourceHash|spanStart|spanEnd|predicate|normalizedObject)[0:16]
  subject: EntityRef;         // resolved entity id, or an unresolved surface form
  predicate: Predicate;       // 'status' | 'target_date' | 'owner' | 'blocks' | 'depends_on' | 'decided' | 'committed' | ...
  object: string | EntityRef | DateValue;
  validFrom: ISODate;
  validTo?: ISODate;
  recordedAt: ISODate;        // document date
  ingestedAt: ISODateTime;
  sourceHash: string;
  span: { start: number; end: number; chunk?: number };
  confidence: number;         // 0..1 from the extractor
  authority: number;          // from source type, applied at merge
  extractorVersion: string;   // hash of prompt + schema + code version
  model: string;
  supersededBy?: string;      // claim id, set when a re-extraction replaces it
}

interface Project {
  id: string; name: string; aliases: string[]; type: ProjectType;
  statusLog: StatusEntry[];   // append-only, sorted by validFrom
  owner?: EntityRef; team?: string; targetDate?: DateWithHistory;
  summary?: string; relations: Relation[]; sourceHashes: string[];
  fileName: string;           // fixed at first emit
}

interface StatusEntry { date: ISODate; status: ProjectStatus; note?: string; claimId: string; corroborating: string[] }
interface DateWithHistory { current: ISODate; history: { date: ISODate; claimId: string; recordedAt: ISODate }[] }
```

Milestone, Blocker, Decision, Commitment, Person, Organization and External follow the PRD field lists. Every entity record carries `renderHash` per generated block so human edits can be detected.

### 3.2 Pipeline stages

Each stage is a pure function over inputs plus a persistence step, so stages can be tested alone and replayed.

```
watch/scan ──▶ detect change ──▶ raw store ──▶ triage ──▶ parse ──▶ chunk
   ──▶ extract (one call per chunk) ──▶ claims.jsonl ──▶ diff vs previous claims of this path
   ──▶ merge (resolve, apply) ──▶ entities/*.json ──▶ render (block-preserving)
   ──▶ bases, days, digest, index, canvas ──▶ lint ──▶ review.md ──▶ git commit ──▶ compile log
```

Job granularity is one source file for ingest through claims, then one merge and render pass per batch window. Merge is serialized (one writer); extraction is parallel up to the concurrency limit.

### 3.3 Change detection (FR1.3)

Table `sources(path, hash, mtime, size, triage, source_type, doc_date, last_processed, extractor_version)`. On scan: skip if mtime and size unchanged; else hash; skip if hash unchanged; else enqueue. On extractor version change, enqueue everything behind a confirmation prompt (FR3.7).

### 3.4 Raw store (FR1.4)

`raw/<hash[0:2]>/<hash>.md` plus `raw/<hash>.meta.json` with original path, mtime, and first-seen time. Content-addressed, so duplicates across folders are stored once. `raw/` is excluded from Obsidian's index through the shipped config.

### 3.5 Triage (FR1.5)

Two passes. Heuristics first: path rules, size bounds, frontmatter hints, filename patterns for known exports, presence of dates and project-like headings. Files the heuristics cannot decide go to the local triage model with a short prompt returning `{ isWork, sourceType, confidence }`. Decisions are stored per source and shown by `cubbon status --triage`. Overrides live in `.cubbon/config.yaml` under `triage.force`.

### 3.6 Parse and chunk (FR2 document date, FR3.3)

- Frontmatter, headings and body via remark. Document date inferred in the PRD's priority order, with the method recorded.
- Chunking by top-level heading, target under 6,000 tokens per chunk, with the document title, date and the previous chunk's heading path prepended so relative dates and pronouns resolve.
- Source pre-processors (M3): email quote stripping and header parsing; chat speaker-turn grouping; ticket field extraction without a model; meeting note sectioning.

### 3.7 Extraction (FR3)

- Prompt assembled from `packages/prompts/<sourceType>.md`, the owner identity block, the ontology description, and the chunk.
- Output is forced through a tool call whose schema is the zod claim list. The extractor also returns `unresolvedDates` and `openQuestions` for the review queue.
- `extractorVersion = sha256(promptText + schemaJson + codeVersion)[0:8]`.
- Cost and tokens recorded per call in `llm_calls`.

### 3.8 Claim diff and supersession

When a path is re-extracted, compare the new claim set with the previous hash's claims for that path. Claims present before and absent now are marked `supersededBy: null, supersededAt` and their downstream entries are flagged, not removed (FR6.5). Claims unchanged keep their ids, so the merge sees no change.

### 3.9 Merge (FR4)

Ordering: claims sorted by `validFrom`, then `recordedAt`. Steps per claim:

1. Resolve subject and object through the alias table, external keys, normalized names, then model-assisted match with a confidence. Below `merge.threshold` (default 0.8), write a proposed-merge review item and hold the claim.
2. Dispatch by predicate: status entries append or insert in order and collapse duplicates into corroborations; target dates append to history and flag slips; blockers open or resolve; decisions attach; commitments open, close on strong evidence, or propose closure.
3. Conflict rule from FR4.6 applied before write.

Merge is idempotent: applying the same claim twice is a no-op because the claim id is recorded on the entry.

### 3.10 Block-preserving writer (FR5.3)

- Parse the existing note. Locate `<!-- cubbon:begin X -->` and `<!-- cubbon:end X -->` pairs.
- For each block, compare the current text hash with `renderHash[X]` from the entity record. If they differ, the user edited inside a generated block. Copy the edited text into the note's Notes section under a dated "Preserved edit" heading, write a review item, then render.
- Everything outside markers is copied verbatim. Frontmatter keys outside the `cubbon` namespace and the standard typed fields are preserved.
- New notes are rendered from the full template.

### 3.11 Bases emission (FR5.8)

Bases files are YAML. Core view types available without plugins are table, cards, list and kanban (1.14 and later). Cubbon writes:

```yaml
# bases/Projects.base
filters:
  and:
    - file.inFolder("wiki/Projects")
    - type == "project"
properties:
  status: { displayName: Status }
  owner: { displayName: Owner }
  target: { displayName: Target }
  status_since: { displayName: Since }
views:
  - type: kanban            # verify the exact type string against the current Bases help page in week 0
    name: Board
    groupBy: { property: status }
    order: [file.name, owner, target, status_since]
  - type: table
    name: All projects
    order: [file.name, status, owner, target, status_since, sources]
  - type: table
    name: At risk
    filters:
      or:
        - status == "at-risk"
        - status == "blocked"
    order: [file.name, status_since, owner, target]
```

Milestones, Blockers and Commitments follow the same pattern. The timeline view comes from the pinned Bases Timeline plugin, which reads start and end date properties; the property names it expects are confirmed in week 0 and emitted on Milestone notes.

### 3.12 Day pages, digest, index

- Day pages are rendered from the claim index grouped by `validFrom`, only for dates with at least one claim. Fully generated, no human section.
- The weekly digest is the one model-written note. Input is the ledger delta for the week (status entries, date history changes, blockers, decisions, commitments), never raw documents. Cassette-recorded for tests.
- `index.md` lists projects by status, open blockers, overdue commitments, latest digest, review count, lint summary.

### 3.13 Review round trip (FR6.2 to FR6.4)

- Items rendered as `- [ ] <text> <!-- rv:<id> -->`. The rendered text is stored so edits can be diffed.
- On each compile: parse `review.md`; for each id, compare with stored text. Checked means confirmed. Text changed means corrected, and the new value is parsed by item type (a date, a name, a status). Line missing means rejected. Answers are persisted and never re-asked.
- Applying answers: merges update `aliases.yaml`; date corrections rewrite the claim's `validFrom` with a `correctedBy: user` marker; closures set commitment status.

### 3.14 Job queue, journal, daemon (FR7)

- Table `jobs(id, kind, path, state, attempts, enqueued_at, started_at, finished_at, error)`. Kinds: ingest, merge, render, digest, lint.
- Watcher events are debounced 2 seconds, then coalesced into ingest jobs. A merge job is scheduled when the batch window closes or the queue drains.
- Journal: each job writes a start record and an end record with the artifacts produced. On startup, jobs in `running` are re-run; claims already written for the same source hash are recognized by id, so no duplication.
- `cubbon watch` runs the worker; `cubbon serve` starts MCP and the local HTTP API in the same process when both are requested. launchd plist and systemd unit are generated by `cubbon daemon install`.

### 3.15 Determinism guarantee (NFR)

Rules enforced by tests: sorted iteration everywhere, no wall-clock values inside generated blocks (`last_seen` derives from claims), stable ids, stable filename allocation, YAML emitted with fixed key order. The CI determinism test compiles the golden set twice from scratch and asserts an empty diff of `wiki/`, `bases/`, `days/` and `.cubbon/entities/`.

## 4. Testing and evaluation

| Layer | What | Tooling |
|---|---|---|
| Unit | Parsers, date inference, claim id, merge handlers, block writer, review parser | bun test |
| Property | Merge idempotency, status log ordering, filename allocation | fast-check |
| Golden set | 40 documents at M0 growing to 120 by M3, with expected claims and expected vault snapshot | eval package, cassettes in CI, live nightly |
| Determinism | Double compile, zero diff | CI job |
| Vault validity | Every wikilink resolves, every `.base` parses, frontmatter types correct | eval package |
| Integration | Temp vault, simulated file events, daemon lifecycle, MCP calls | bun test with child processes |
| Manual | Obsidian smoke checklist per milestone: graph colours, board, timeline, daily notes, canvas | checklist in docs/ |

Golden set metrics computed per run: status precision and recall, date precision, merge errors, review items per document, cost. Thresholds from the PRD gate the nightly job.

## 5. Milestone plans

Effort is in engineer-days. Sequencing puts the risky, load-bearing pieces first: extraction, merge and determinism before any view work.

### Week 0: setup and spikes (both engineers, 5 days)

| Task | Owner | Days | Output |
|---|---|---|---|
| Repo, workspaces, biome, CI skeleton, bun test | B | 1 | Green pipeline on an empty package |
| Spike: @parcel/watcher and bun:sqlite under Bun; single-file build on macOS arm64 | B | 1 | ADR-001 confirmed or fallback chosen |
| Spike: Anthropic structured output with the zod claim schema on 5 real docs | A | 1.5 | Sample claims, prompt v0 |
| Spike: Ollama triage model choice (a 4B class model) on 200 mixed files | A | 1 | Precision on work-or-not, latency |
| Verify Bases kanban type string, Bases Timeline property names, graph.json colour group format, JSON Canvas spec | B | 0.5 | Notes in docs/ |
| Write ADR-001 to ADR-006 | A, B | 1 | docs/adr/ |
| Assemble golden set v0: 40 documents from real or realistic PRDs, roadmaps, sprint notes, with hand-labelled expected claims | A | 2 (overlaps) | fixtures/golden/ |

### M0 Foundations, weeks 1 to 3 (PRD P0 core)

Goal: `cubbon compile` over a folder of Markdown produces a deterministic vault that opens in Obsidian with a board and a coloured graph.

| # | Task | FR | Owner | Days | Depends on |
|---|---|---|---|---|---|
| 0.1 | Config loading, vault init, global config, keychain | FR9.2 | B | 2 | W0 |
| 0.2 | Scan, exclusions, mtime plus hash state, sources table | FR1.1 to FR1.3 | B | 2 | 0.1 |
| 0.3 | Raw store | FR1.4 | B | 1 | 0.2 |
| 0.4 | Heuristic triage, source type stub (document only) | FR1.5 | A | 1.5 | 0.2 |
| 0.5 | Markdown parse, frontmatter, doc date inference, chunking | FR2 | A | 2.5 | W0 |
| 0.6 | Provider interface, Anthropic and Ollama, cassette recorder, cost table | FR9.1, FR9.6 | A | 2.5 | W0 |
| 0.7 | Claim schema, prompt v1 for documents, owner block, extractor version, claim ids | FR3.1 to FR3.3, FR3.6, FR3.7 | A | 3 | 0.5, 0.6 |
| 0.8 | Claims JSONL persistence, SQLite index, claim diff and supersession | ADR-002 | A | 2 | 0.7 |
| 0.9 | Entity model and persistence | ADR-002 | B | 2 | W0 |
| 0.10 | Alias table, resolution ladder without model assist, person and org handling | FR4.1, FR4.2 | A | 2.5 | 0.8, 0.9 |
| 0.11 | Merge handlers: status log, milestone dates and slips, blockers, decisions, relations | FR4.4, FR4.5, FR4.8 | A | 3 | 0.10 |
| 0.12 | Renderers for Project, Milestone, Blocker, Decision, Person, Organization, External, Source notes | FR5.4, FR5.5 | B | 3 | 0.9 |
| 0.13 | Block-preserving writer, filename allocator, aliases frontmatter | FR5.1 to FR5.3 | B | 2.5 | 0.12 |
| 0.14 | Bases files, `.obsidian` config, index.md | FR5.8, FR5.9 | B | 2 | 0.13 |
| 0.15 | Orchestrator for `compile`, run record, compile log v0, journal | FR7.1, FR7.5 | B | 2.5 | 0.11, 0.14 |
| 0.16 | Golden runner, determinism test, vault validity test | Testing | A | 2 | 0.15 |
| 0.17 | Obsidian smoke checklist and fixes | | B | 1 | 0.15 |

Exit: golden set at or above the PRD precision and recall targets on the document source type; determinism test green; vault opens in Obsidian with board, table, coloured graph and resolving links; `cubbon compile` on 400 documents finishes under 10 minutes with concurrency 8.

### M1 Trust, weeks 4 to 5

Goal: two weeks of dogfooding on the engineers' own documents with review load under target.

| # | Task | FR | Owner | Days | Depends on |
|---|---|---|---|---|---|
| 1.1 | Review queue writer with typed items and ids | FR6.2 | B | 2 | M0 |
| 1.2 | Review answer parser and feedback application | FR6.4 | B | 2.5 | 1.1 |
| 1.3 | Model-assisted merge with threshold and proposed-merge items | FR4.2 | A | 2 | 1.1 |
| 1.4 | Ambiguous date and low-confidence status items, thresholds in config | FR6.3 | A | 1.5 | 1.1 |
| 1.5 | Human edit detection inside generated blocks, preserved edits, review item | FR5.3 | B | 1.5 | 1.1 |
| 1.6 | No-delete policy audit: retire instead of remove across handlers | FR6.5 | A | 1 | M0 |
| 1.7 | Lint checks and hub summary | FR6.6 | B | 1.5 | M0 |
| 1.8 | Vault git history: init, commit per run, `cubbon status` shows last commits | FR5.11 | B | 1 | M0 |
| 1.9 | Compile log v1 with cost, duration, counts | FR6.1 | A | 1 | M0 |
| 1.10 | Dogfood: both engineers run daily on their own folders, log review load, tune prompts and thresholds | | A, B | 3 | 1.2 |

Exit: review items per document under one in three by end of week 5 on dogfood vaults; review round trip verified for every item type; a manual edit inside a generated block survives and is surfaced.

### M2 Always on, weeks 6 to 8

Goal: the daemon runs a week unattended, day pages and digest appear, MCP answers with citations.

| # | Task | FR | Owner | Days | Depends on |
|---|---|---|---|---|---|
| 2.1 | Watcher, debounce, coalescing, job queue, worker loop | FR7.2 | B | 3 | M1 |
| 2.2 | Batch window, merge scheduling, crash recovery from journal | FR7.5 | B | 2 | 2.1 |
| 2.3 | `daemon install` for launchd and systemd, `pause`, `resume`, `status` | FR7.3, FR7.6 | B | 2 | 2.1 |
| 2.4 | Resource limits: concurrency, per-run token budget, daily spend cap | FR7.4 | A | 1.5 | M1 |
| 2.5 | Day pages renderer and Daily Notes config | FR5.6 | A | 1.5 | M1 |
| 2.6 | Weekly digest: ledger delta, prompt, cassette, scheduling | FR5.7 | A | 2.5 | 2.5 |
| 2.7 | Local HTTP API: status, queue, review count, recent runs | api | B | 1 | 2.1 |
| 2.8 | MCP server, stdio and HTTP, read tools from PRD appendix E, citations | FR8.1, FR8.2, FR8.4 | A | 3.5 | M1 |
| 2.9 | Integration tests: simulated events, daemon lifecycle, MCP calls | Testing | A, B | 2 | 2.8 |
| 2.10 | Week-long unattended run on both machines, fix what breaks | | A, B | 2 | 2.9 |

Exit: seven days unattended without a stuck queue or duplicated claim; a changed file reflected in the vault within 60 seconds of the batch window; MCP `what_changed` and `explain` return correct citations on the golden vault.

### M3 Mixed sources, weeks 9 to 12

Goal: email, chat, ticket and meeting exports become sources, commitments have a lifecycle, and precision holds on a real mixed week.

| # | Task | FR | Owner | Days | Depends on |
|---|---|---|---|---|---|
| 3.1 | Export shape detection: Outlook, Gmail, Webex, Slack, Jira, Confluence, Granola, Fireflies, screenpipe, Rowboat sync folders | FR1.6 | B | 3 | M2 |
| 3.2 | Email pre-processor: headers, quoted reply stripping, thread ordering | FR3.4 | A | 2 | 3.1 |
| 3.3 | Chat pre-processor: speaker turns, time-window chunks | FR3.4 | A | 1.5 | 3.1 |
| 3.4 | Ticket parser: fields to claims without a model, external key resolution | FR3.4, FR4.2 | A | 2 | 3.1 |
| 3.5 | Meeting note pre-processor | FR3.4 | A | 1 | 3.1 |
| 3.6 | Source-type prompts and golden documents per type (email, chat, ticket, meeting), 80 new fixtures | FR3.4 | A | 3 | 3.2 to 3.5 |
| 3.7 | Authority weights, conflict rule, open-question items | FR3.5, FR4.6 | A | 2 | 3.6 |
| 3.8 | Commitment lifecycle: open, close by ticket, close by strong statement, propose closure, stale ageing | FR4.7 | A | 3 | 3.7 |
| 3.9 | Person directory: seed from exported contacts, email keyed, handle aliases | FR4.3 | B | 2 | 3.1 |
| 3.10 | Commitments base and digest sections for overdue and closed | FR5.8 | B | 1.5 | 3.8 |
| 3.11 | Redaction before model calls, patterns in config, log entries | FR9.4 | B | 1.5 | M2 |
| 3.12 | Local-only mode end to end with the Ollama extractor, degraded-mode review behaviour | FR9.3 | B | 2 | M2 |
| 3.13 | Real-week evaluation: one engineer's actual exports for one week, hand-labelled, metrics computed | | A, B | 3 | 3.10 |

Exit: precision targets on the mixed golden set; commitment proposals accepted at 70 percent or more on the real week; wrong merges under 2 percent; local-only mode produces a usable vault.

### M4 v1.0, weeks 13 to 16

Goal: public release with an Obsidian plugin, packaged binaries, docs and read-only connectors.

| # | Task | FR | Owner | Days | Depends on |
|---|---|---|---|---|---|
| 4.1 | Obsidian plugin: status bar, run compile, review panel rendering review.md, open source span | plugin | B | 5 | 2.7 |
| 4.2 | Plugin to daemon auth: local token in `.cubbon/`, loopback only | plugin | B | 1 | 4.1 |
| 4.3 | Packaging: single-file builds for macOS arm64 and x64, Linux x64, Windows x64; Homebrew tap; checksums; signing and notarization on macOS | NFR | B | 4 | M3 |
| 4.4 | Windows watcher and service path | FR7.3 | B | 2 | 4.3 |
| 4.5 | Read-only connectors writing Markdown to the inbox on a schedule: Jira and Confluence via REST | FR1.8 | A | 4 | M3 |
| 4.6 | JSON Canvas portfolio board | FR5.10 | A | 2 | M3 |
| 4.7 | Opt-in telemetry with counts only, disclosure text, config flag | FR9.5 | A | 1.5 | M3 |
| 4.8 | Docs site: install, first run, folders and exclusions, models, review workflow, MCP setup for Claude and Cursor, troubleshooting | docs | A, B | 3 | 4.3 |
| 4.9 | Security pass: permissions on raw store, key handling, HTTP bound to loopback, redaction defaults | NFR | A | 1.5 | 4.2 |
| 4.10 | Beta with five external users for two weeks, triage feedback, fix | | A, B | 4 | 4.8 |
| 4.11 | Release: tag, binaries, tap, announcement | | B | 1 | 4.10 |

Exit: five beta users reach a working vault in under ten minutes; retention metric instrumented; release published.

### After v1.0

Time-scrubbed graph viewer (a small web app over `.cubbon/` using a GPU graph library and a timeline strip), write MCP tools, Cognee export, team vault sync, hosted compile. Scoped after v1.0 usage data.

## 6. Schedule and critical path

```
W0  setup, spikes, golden v0
W1  0.1 0.2 0.5 0.6 0.9            parallel: B on fs and model, A on parse and llm
W2  0.3 0.4 0.7 0.8 0.10 0.12       extraction and claims (A) | renderers (B)
W3  0.11 0.13 0.14 0.15 0.16 0.17   merge (A) | writer, bases, orchestrator (B)  ── M0 exit
W4  1.1 1.3 1.4 1.5 1.6 1.7 1.8 1.9
W5  1.2 1.10 dogfood                                                          ── M1 exit
W6  2.1 2.4 2.5 2.8
W7  2.2 2.3 2.6 2.7 2.8
W8  2.9 2.10 unattended week                                                  ── M2 exit
W9  3.1 3.2 3.3 3.11
W10 3.4 3.5 3.6 3.9 3.12
W11 3.7 3.8 3.10
W12 3.13 real-week eval                                                       ── M3 exit
W13 4.1 4.3 4.5
W14 4.1 4.2 4.4 4.5 4.6 4.7
W15 4.8 4.9 4.10 beta
W16 4.10 4.11 release                                                         ── M4 exit
```

Critical path: 0.6 to 0.7 to 0.8 to 0.10 to 0.11 to 0.15 to 0.16 (extraction, merge, determinism), then 1.2 (review round trip), then 2.1 to 2.2 (queue and recovery), then 3.6 to 3.8 (mixed prompts and commitments). View work never sits on the critical path.

Buffer: none is scheduled inside milestones. If M0 slips more than a week, cut 0.14 Bases to a single table view and carry the board into M1.

## 7. Definition of done

Every task: unit tests, biome clean, typecheck clean, cassette recorded if it touches a model, ADR updated if it changes a decision, golden metrics not regressed.

Every milestone: exit criteria met and recorded in `docs/milestones.md` with the metric values; Obsidian smoke checklist signed off; dogfood vaults compiled with the release build.

## 8. Risks specific to implementation

| Risk | Signal | Response |
|---|---|---|
| Bun incompatibility with a native dependency | Week 0 spike fails | Switch to Node 22 with tsx and esbuild before M0 starts; the code targets both |
| Structured output drifts or truncates on long chunks | Schema validation failures in cassettes | Lower chunk size, retry with a repair prompt, record failure rate in the compile log |
| Golden set too easy | High scores in CI, poor dogfood experience | Add dogfood failures to the golden set weekly during M1 |
| Merge threshold tuning consumes M1 | Review load not falling by week 5 | Ship with conservative thresholds and a per-type override; treat tuning as ongoing |
| Bases format changes in an Obsidian release | Vault validity test fails to parse | Bases emitter behind a version switch; keep table view as the guaranteed fallback |
| Watcher misses events on large trees or network drives | Files not compiled after change | Periodic scan every 15 minutes as a safety net, configurable |
| Cost spikes on first run over a large folder | Spend cap hit during init | Init reports the estimate before compiling and asks for confirmation; triage locally |
| Windows packaging late | 4.3 slips | Windows ships as a follow-up release; documented in the announcement |

## 9. Week 1 checklist

- [ ] Repo created, workspaces configured, CI green on an empty test
- [ ] ADR-001 to ADR-006 merged
- [ ] Spike results recorded: watcher, SQLite, structured output, triage model, Bases and timeline property names
- [ ] Golden set v0 in `fixtures/golden/` with expected claims for 40 documents
- [ ] Config schema and `cubbon init` create a vault with `.obsidian/` config
- [ ] Provider interface with Anthropic and Ollama implementations and cassette recorder
- [ ] Markdown parse, document date inference and chunking with tests
- [ ] First end-to-end: one document in, one Project note and one Source note out, by hand-run script
