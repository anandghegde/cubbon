# Cubbon: Product Requirements Document

| | |
|---|---|
| Status | Draft v0.1 |
| Date | 2026-09-25 |
| Owner | TBD |
| Assumption | The extraction feasibility test (dated status changes from real PRDs and sprint notes) has passed. This PRD builds on that result. |

---

## 1. One-line definition

Cubbon is a local daemon that compiles a folder of work documents into a dated, typed, Obsidian-compatible wiki, and keeps it current as the documents change.

Point it at the folders where your work already lands. It produces a vault of Projects, Milestones, Blockers, Decisions, People and Commitments, each entry dated and linked to the source that said it. Obsidian is the screen. An MCP server lets any agent ask what changed.

## 2. Problem

Knowledge workers running several projects accumulate the state of their work across PRDs, roadmaps, sprint notes, meeting notes, exported emails, chat threads and ticket dumps. The state exists, but it is scattered, undated and unlinked. The questions that matter most are the hardest to answer:

- What is the current status of each project, and when did it change?
- Which dates have slipped, and where did the new date come from?
- What is blocked, by what, and for how long?
- What did I or others commit to, and is it still open?
- Which projects depend on or share problems with each other?

Existing tools solve adjacent problems. Graph memory engines (Cognee, Graphiti) extract entities but have no wiki output and no work ontology. Obsidian shows a graph but extracts nothing. LLM-wiki compilers (Graphify, Karpathy-style skills) produce prose summaries without dates or typed state. Rowboat builds a Project vault, but only from live email, calendar and chat streams it syncs itself, with a single overwritten status field and a curation pass that collapses history. Screenpipe and Littlebird capture the screen, not documents, and stop at reports.

Nobody turns a folder of documents into a dated ledger of project state with a graph and timeline, locally.

## 3. Goals and non-goals

### Goals

1. Zero-effort ingestion: watch folders the user already uses and pick up Markdown automatically.
2. Work-aware extraction: a fixed ontology of Project, Milestone, Status change, Blocker, Decision, Person, Organization, External reference and Commitment, every claim carrying a date, a source and a confidence.
3. A ledger, not a summary: status changes and date slips are appended with dates, never overwritten.
4. Obsidian-native output: the vault opens in Obsidian with graph, Kanban, timeline and canvas views pre-configured, using core features and a short pinned plugin list.
5. Agent access: an MCP server over the vault from the first release.
6. Local-first: all data on the user's machine, model choice local or API, nothing leaves the machine except model calls the user configured.
7. Trustworthy: every generated claim can be traced to a source span; uncertain work goes to a review queue rather than silently into the wiki.

### Non-goals

- Not a notes editor. Obsidian, or any Markdown editor, is the editor.
- Not chat over documents. Retrieval is a by-product, not the product.
- Not a task manager or Jira replacement. Cubbon records commitments and links tickets; it does not manage them.
- Not an AI coworker. Cubbon never sends, posts or acts on the user's behalf.
- Not a screen recorder. Inputs are files. Screen capture tools are upstream sources.
- Not a team collaboration server in v1. Team mode is a later phase.

## 4. Users

| Persona | Situation | What Cubbon gives them |
|---|---|---|
| Portfolio lead (Director of Product or Engineering) | 8 to 30 projects, weekly status asks, docs written by others | Kanban of status with dates, weekly digest, slips surfaced automatically |
| IC product manager | 2 to 5 projects, PRDs, sprint notes, stakeholder email | A single project page with status log, milestones, decisions and open commitments |
| Engineering manager | Team roadmap, sprint notes, Jira exports, incident notes | Blockers and dependencies across projects, TODOs by owner |
| Consultant or fractional operator | Several clients, each a folder of docs | One vault per client, MCP access from their coding or chat agent |

Primary persona for v1 is the portfolio lead. They have the most documents, the least time, and the highest tolerance for a review queue if it saves a weekly status meeting.

## 5. Product principles

1. **Files are the truth.** The vault is plain Markdown the user owns. Deleting Cubbon leaves a working Obsidian vault.
2. **Every claim has a date and a source.** Undated claims are flagged, not published.
3. **Append, never overwrite state.** A status is a log entry, not a field.
4. **Structured sources are the spine.** Ticket exports are parsed, not extracted. Fuzzy sources hang on them.
5. **Propose, then confirm.** Merges, TODO closures and conflicting dates are proposed to the review queue when confidence is low.
6. **Deterministic re-runs.** Unchanged input produces zero diff in the vault.
7. **Obsidian first, own viewer later.** Build views Obsidian cannot only after the data has earned it.

## 6. User experience

### 6.1 First run

```
$ cubbon init
  Watching: ~/Documents, ~/Desktop, ~/Downloads, ~/Documents/cubbon-inbox
  Excluding: .git, node_modules, .obsidian, *.tmp, ~/Documents/Personal
  Model: claude (API key found in keychain)   Triage: local (ollama/qwen3:4b)
  Vault: ~/Cubbon Vault
  Found 1,214 Markdown files, 388 look like work documents. Compile now? [Y/n]
```

Cubbon triages the files, compiles the work documents, and opens the vault in Obsidian. The user sees a hub page, a Projects board, a coloured graph, and a review queue with the merges and dates Cubbon was unsure about. Target: first useful vault within 10 minutes of install for 400 documents on an API model.

### 6.2 Every day

The daemon watches the folders. A new sprint note or an exported email thread is picked up, compiled within a minute, and the affected project pages, day page and review queue are updated. The user notices nothing unless the review queue asks a question.

### 6.3 Every week

A digest note appears: status changes, slips, new and resolved blockers, decisions, and overdue commitments, each with a link to the source. This is the note most users will read.

### 6.4 On demand

From Claude, Cursor, Claude Desktop or any MCP client:

- "What changed on Payments Revamp since September 1?"
- "Which projects share a blocker with Ledger Service?"
- "Where did the November 15 date come from?"
- "What have I committed to that is overdue?"

Answers come from the vault with links to source spans.

### 6.5 Review

The review queue is a note. Each item is a checkbox with the proposal, the evidence and the sources. Ticking it confirms; editing the line corrects; deleting it rejects. The next compile reads the answers and updates the alias table, the status log or the commitment. Nothing in the vault is deleted by Cubbon without a confirmed review item.

## 7. Functional requirements

Requirements are tagged P0 (v0.1), P1 (v0.2 and v0.3), P2 (v1.0 and later).

### FR1 Ingest

| ID | Requirement | Priority |
|---|---|---|
| FR1.1 | Watch a configurable list of folders recursively for Markdown files. Defaults: Documents, Desktop, Downloads, and a dedicated inbox folder. Never the home directory root by default. | P0 |
| FR1.2 | Exclude patterns by default: version control folders, package folders, other Obsidian vaults, temp files, and a user-editable personal exclusion list. | P0 |
| FR1.3 | Change detection by mtime then content hash. Unchanged content is never re-extracted. | P0 |
| FR1.4 | Immutable raw store: every ingested file is copied into the vault's raw store keyed by content hash, with original path and timestamps. Sources that are later deleted or moved remain citable. | P0 |
| FR1.5 | Triage stage: a cheap classifier (heuristics plus a small local model) labels each file as work or not, and by source type: document, email, chat, ticket, meeting, other. Only work files proceed to extraction. Triage decisions are visible and overridable per folder and per file. | P0 |
| FR1.6 | Source-type detection for common export shapes: Outlook and Gmail Markdown exports, Webex and Slack chat exports, Jira and Confluence Markdown exports, Granola, Fireflies and screenpipe meeting notes, Rowboat sync folders. | P1 |
| FR1.7 | Converters for non-Markdown inputs: docx, PDF, HTML, Notion and Google Docs exports, into Markdown before the pipeline. | P2 |
| FR1.8 | Read-only API connectors that write Markdown into the inbox on a schedule: Jira, Confluence, Outlook. | P2 |

### FR2 Ontology and time model

The ontology is fixed and small. Users may add aliases and tags, not entity types, in v1.

**Entities**

| Entity | Key fields |
|---|---|
| Project | name, aliases, type (product, initiative, deal, internal, other), status log, owner, team, target date, summary, related projects with relation type |
| Milestone | name, project, target date with change history, status (planned, at-risk, hit, missed, dropped), achieved date |
| Blocker | title, projects and milestones blocked, opened date, resolved date, owner, severity |
| Decision | title, date, projects affected, rationale, decided by |
| Commitment | text, owner, due date, opened date, status (open, done, dropped, stale), closing evidence, linked ticket |
| Person | name, aliases (emails, handles, short names), role, organization |
| Organization | name, type (team, vendor, customer, partner) |
| External reference | kind (jira, confluence, figma, github, url, other), key, url, projects |
| Source | path, hash, source type, document date, ingested date, authority weight, claim count |

**Status vocabulary** for Projects: planned, on-track, at-risk, blocked, on-hold, done, cancelled.

**Relations**: project depends on project; project shares blocker with project; project shares owner with project; milestone belongs to project; person owns project, milestone, blocker or commitment; blocker blocks project or milestone; decision affects project; external reference belongs to project; source supports claim.

**Time model**. Every claim carries three times:

- valid time: when the fact was true or is due (the date inside the document);
- recorded time: the document's date;
- ingested time: when Cubbon saw it.

Day pages and timelines use valid time. The compile log uses ingested time. The two are never mixed.

**Claim**. The unit of extraction. A claim is subject, predicate, object, valid time, source hash, source span, confidence, extractor version. Its identifier is a hash of source hash, span, predicate and object, so re-extracting an unchanged file yields identical claims.

**Document date inference** in priority order: frontmatter date, date in filename, first date in the title or first heading, first date in the body, file modification time. The last two are marked low confidence and surface in the review queue if they anchor a status change.

### FR3 Extraction

| ID | Requirement | Priority |
|---|---|---|
| FR3.1 | One source file per extraction call. Never batch files into one prompt, to prevent entities bleeding between documents. | P0 |
| FR3.2 | Structured output against the claim schema. Free text is not accepted from the extractor. | P0 |
| FR3.3 | Relative dates ("next Friday", "end of Q4") are resolved against the document date, and the resolution is recorded with the claim. | P0 |
| FR3.4 | Source-type prompts: document, email (quoted replies stripped, only the new text extracted), chat (speaker-aware chunks), meeting notes, ticket (fields parsed without a model). | P1 |
| FR3.5 | Authority weights per source type, used in conflict resolution: ticket fields highest, owner email high, PRD and Confluence medium, chat low. Weights are configurable. | P1 |
| FR3.6 | Owner identity block: the user's name, emails and handles are injected into every extraction so first-person text is attributed correctly and the user is never created as a Person note. | P0 |
| FR3.7 | Extractor version is stamped on every claim. A version bump triggers re-extraction on the next compile, gated behind a confirmation because of cost. | P0 |
| FR3.8 | A golden set of documents with expected claims ships with the repo and runs as a regression test on every extractor or model change. | P0 |

### FR4 Merge and entity resolution

| ID | Requirement | Priority |
|---|---|---|
| FR4.1 | Alias table per vault mapping surface forms to entity ids for projects, people, organizations and external references. Confirmed review items add to it. | P0 |
| FR4.2 | Resolution order: exact alias, external key (ticket id, email address), normalized name match, then model-assisted match with a confidence. Below threshold, the merge is proposed, not applied. | P0 |
| FR4.3 | Person directory seeded from exported contacts when available, keyed by email, with display names and handles as aliases. | P1 |
| FR4.4 | Status log append: a new status claim with a later valid time than the current head is appended. An earlier valid time is inserted in order. The same status from a new source is recorded as corroboration, not a change. | P0 |
| FR4.5 | Date slip detection: a milestone target date claim that differs from the current target is appended to the date history and flagged as a slip or pull-in in the digest. | P0 |
| FR4.6 | Conflict rule: when two claims disagree, the one with higher authority weight wins; at equal authority the later recorded time wins; at equal authority within 7 days both are kept and an open question is written to the review queue. The losing claim stays in the log. | P1 |
| FR4.7 | Commitment lifecycle: opened by extraction; closed by a linked ticket transition, by an explicit closing statement from the owner with high confidence, or by a confirmed review item; marked stale after a configurable period past due; never auto-deleted. | P1 |
| FR4.8 | Idempotency: a compile over unchanged inputs produces no vault changes and no log entries beyond a heartbeat. | P0 |

### FR5 Vault emission

**Layout**

```
Cubbon Vault/
  raw/                       immutable copies, by content hash (hidden from graph)
  wiki/
    Projects/  Milestones/  Blockers/  Decisions/  People/  Organizations/  External/
    Sources/                 one note per ingested document with its claims
  days/YYYY-MM-DD.md         time index, valid time, only days with claims
  digests/YYYY-Www.md        weekly narrative
  log/YYYY-MM-DD.md          compile log, ingested time
  review.md                  review queue
  index.md                   hub
  bases/                     Projects.base, Milestones.base, Blockers.base, Commitments.base
  canvas/Portfolio.canvas    optional JSON Canvas board
  .obsidian/                 graph colours, daily notes folder, pinned plugin list
  .cubbon/                   state, alias table, person directory, config
```

| ID | Requirement | Priority |
|---|---|---|
| FR5.1 | Unique note filenames across the vault, since wikilinks resolve by name. Collisions get a disambiguating suffix. Renames are tracked by the entity id in frontmatter. | P0 |
| FR5.2 | Frontmatter with typed fields (type, status, dates in ISO format, owner, cubbon id) so Bases can filter and sort without plugins. Cubbon owns keys under its own namespace and preserves all other keys. | P0 |
| FR5.3 | Generated blocks are fenced with begin and end markers. Content outside markers is human-owned and preserved verbatim across compiles. Human edits inside markers are detected, preserved in a side note, and surfaced in the review queue. | P0 |
| FR5.4 | Project note sections: summary, status log, milestones, blockers, open commitments, decisions, dependencies and links, open questions. Each entry carries a date and a link to its Source note. | P0 |
| FR5.5 | Source notes: one per document, listing every claim extracted with its span, so any wiki statement can be traced in two clicks. | P0 |
| FR5.6 | Day pages: one per date with at least one claim, listing the claims by project with source links. Future dates are allowed for targets and due dates. | P1 |
| FR5.7 | Weekly digest: status changes, slips, blockers opened and resolved, decisions, overdue commitments, new projects, each with sources. Generated by the model from the ledger, never from raw documents. | P1 |
| FR5.8 | Bases files generated and kept current: Projects (board by status, table, at-risk filter), Milestones (table by target date, timeline view via pinned plugin), Blockers (open, by project), Commitments (open by owner, overdue). | P0 |
| FR5.9 | Shipped Obsidian configuration: graph colour groups by folder, Daily Notes pointed at the days folder, pinned plugin list. Applied on init and never overwritten afterwards. | P0 |
| FR5.10 | JSON Canvas portfolio board: project cards positioned by target date, connectors for dependencies and shared blockers. Regenerated on demand, not on every compile. | P2 |
| FR5.11 | Vault version history: each compile is a commit in a local git repository inside the vault so any run can be inspected and reverted. | P1 |

### FR6 Review and lint

| ID | Requirement | Priority |
|---|---|---|
| FR6.1 | Compile log per run: files processed, claims added, merges applied, conflicts, cost and duration. | P0 |
| FR6.2 | Review queue as a checklist note with typed items: proposed merge, ambiguous date, conflicting status, low-confidence status change, commitment closure, human edit inside generated block. | P0 |
| FR6.3 | Confidence thresholds configurable per item type. Defaults tuned so that after two weeks fewer than one review item is produced per three documents. | P0 |
| FR6.4 | Answers in the review note feed the next compile: confirmed merges update the alias table, corrected dates update the claim, rejected items are remembered so they are not proposed again. | P0 |
| FR6.5 | No-delete policy: Cubbon never removes a note or a log entry without a confirmed review item. Retired entities are marked, not deleted. | P0 |
| FR6.6 | Lint checks: undated claims, projects with no owner, milestones with no date, commitments past due, orphan notes, broken wikilinks. Results appear in the log and the hub. | P1 |

### FR7 Daemon and CLI

| ID | Requirement | Priority |
|---|---|---|
| FR7.1 | Commands: init, compile, watch, serve, status, review, doctor, export, pause, resume. | P0 |
| FR7.2 | Watch mode with native file events, a 2 second debounce, and a batch window (default 5 minutes) so bursts of changes compile together. | P1 |
| FR7.3 | Background service installation for macOS launchd and Linux systemd. Windows service later. | P1 |
| FR7.4 | Resource limits: concurrency, per-run token budget, daily spend cap for API models, with a clear pause when a cap is hit. | P1 |
| FR7.5 | Crash safety: state written through a journal so an interrupted compile resumes without duplicating claims. | P0 |
| FR7.6 | Status output shows watched folders, queue depth, last compile, cost today, review items pending. | P0 |

### FR8 MCP server and API

| ID | Requirement | Priority |
|---|---|---|
| FR8.1 | Local MCP server over the vault, stdio and streamable HTTP. Read-only by default. | P1 |
| FR8.2 | Tools: search, get entity, what changed since a date optionally scoped to a project, timeline for a project or the portfolio, open blockers, commitments by owner and status, explain a claim (returns the source span), sources for an entity, review queue. | P1 |
| FR8.3 | Write tools, gated by a config flag: confirm merge, resolve review item, add alias. No tool creates or deletes notes. | P2 |
| FR8.4 | Every response cites source note paths so an agent can quote provenance. | P1 |
| FR8.5 | Optional export of the vault into a Cognee instance for cross-source retrieval. Cognee is never the source of truth. | P2 |

### FR9 Models and privacy

| ID | Requirement | Priority |
|---|---|---|
| FR9.1 | Model roles: triage (small, local by default), extract (strong), merge assist (strong), digest (strong). Each role is configurable independently. | P0 |
| FR9.2 | Providers: local via Ollama or LM Studio, and API providers with keys stored in the OS keychain. When an API provider is used, default to the latest Claude model available. | P0 |
| FR9.3 | Local-only mode: a single switch that disables all network calls. Quality degrades and the review queue grows; the product still works. | P0 |
| FR9.4 | Redaction before model calls: configurable patterns for secrets, card numbers and identifiers, applied to extraction input and recorded in the log. | P1 |
| FR9.5 | No telemetry by default. Opt-in usage metrics contain counts and durations only, never content. | P0 |
| FR9.6 | Every model call is logged with role, model id, token counts and cost, aggregated in status output. | P0 |

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| First compile | 400 work documents compiled in under 10 minutes on an API model with default concurrency. |
| Incremental latency | A changed document is reflected in the vault within 60 seconds of the batch window closing. |
| Scale | 10,000 documents, 200 projects, 5,000 claims per project without degraded Obsidian performance. Raw store excluded from the Obsidian index. |
| Determinism | Re-running compile on unchanged input yields zero vault diff. Verified in CI against the golden set. |
| Footprint | Daemon idle memory under 300 MB. No background CPU when the queue is empty. |
| Reliability | State journal survives kill during compile. Vault git history allows full revert. |
| Compatibility | Vault opens in current Obsidian with core features only. Pinned plugins are optional enhancements. |
| Platforms | macOS first, Linux second, Windows in v1.0. Apple Silicon and Intel. |
| Packaging | Single binary via Homebrew and a direct download; pip and npm wrappers later. |
| Security | Files never leave the machine except as model call input to the configured provider. Keys in keychain. Raw store respects original file permissions. |

## 9. Success metrics

| Metric | Target at v1.0 | How measured |
|---|---|---|
| Status change precision | 0.85 or higher | Golden set and monthly labelled sample |
| Status change recall | 0.70 or higher | Same |
| Wrong merges | Under 2 percent of entities | Review queue rejections plus audit |
| Review load | Under 1 item per 3 documents after week 2 | Compile log |
| Time to first vault | Under 10 minutes for 400 documents | Instrumented init |
| Weekly digest read | Opened in 3 of 4 weeks by active users | Opt-in telemetry, file open events via plugin |
| MCP usage | At least one query per active day for agent-using personas | Opt-in telemetry |
| Retention | 60 percent of installs still compiling at day 30 | Opt-in telemetry |

## 10. Release plan

| Milestone | Scope | Exit criteria |
|---|---|---|
| M0 Foundations, weeks 1 to 3 | Ontology, claim model, extractor with structured output, alias table, merge, status log, vault emission, Bases, Obsidian config, `compile` CLI. Markdown documents only. | Golden set passes. Deterministic re-run. Vault opens in Obsidian with board and graph. |
| M1 Trust, weeks 4 to 5 | Review queue, feedback loop, compile log, lint, Source notes, human-block preservation, vault git history. | Two weeks of dogfooding with review load under target. |
| M2 Always on, weeks 6 to 8 | Daemon, watch, batch window, raw store, launchd and systemd, day pages, weekly digest, MCP server read-only. | Daemon runs a week unattended. MCP queries answered with citations. |
| M3 Mixed sources, weeks 9 to 12 | Email, chat, ticket and meeting parsers, authority weights, conflict rule, commitment lifecycle, person directory, Rowboat and screenpipe folders as inputs. | One user week of real mixed data: precision targets hit, TODO proposals accepted at 70 percent or more. |
| M4 v1.0, weeks 13 to 16 | Obsidian plugin (run compile, review panel, status), packaging for macOS, Linux and Windows, docs, read-only Jira and Confluence connectors, canvas board, opt-in telemetry. | Public release. |
| Later | Time-scrubbed graph viewer, team vault sync, hosted compile, Cognee export, write MCP tools. | Driven by v1.0 usage. |

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Extraction drift when models change | Pin model ids per role, stamp extractor version, golden set regression in CI, re-extraction gated behind confirmation. |
| Wrong merges erode trust quickly | Conservative thresholds, propose-then-confirm, alias table grows from confirmations, wrong-merge metric tracked. |
| Commitment close-out is weak | Design for it: proposals age visibly, ticket transitions close automatically, users confirm the rest. Never auto-close on weak evidence. |
| Cost on wide folders | Triage locally, extract only work files, batch window, daily spend cap, cost visible in status. |
| Privacy of watched folders | Explicit folder list, personal exclusion list, redaction, local-only mode, no telemetry by default. |
| Rowboat adds folder ingestion and milestones | Compete on extraction quality, time model and views, not plumbing. Stay interoperable with Rowboat's vault conventions so coexistence is the default. |
| Obsidian plugin ecosystem shifts | Depend on core features (Bases, graph, canvas, daily notes). Plugins are pinned and optional. |
| Human edits conflict with generated blocks | Marker fences, side-note preservation, review item. Never silently overwrite. |
| Long documents exceed context | Chunk by heading with document date and title carried into each chunk; claims carry chunk spans. |

## 12. Open questions

1. Licensing split for open core: which of ontology, extractor prompts and Obsidian emitter are open, and which of connectors, viewer and team mode are paid.
2. Pricing: personal free tier, pro tier in the twenty dollar a month range, or a per-seat annual licence like Obsidian's commercial plan.
3. Whether commitments ship in M0 as extraction-only, or wait for M3 with the full lifecycle.
4. Whether non-Markdown converters (docx, PDF) belong before or after v1.0 given the primary persona's document mix.
5. Windows priority relative to the Obsidian plugin.
6. How much of the raw store to keep by default, and retention policy for large inboxes.

## 13. Appendix

### A. Project note template

```markdown
---
type: project
cubbon_id: prj_7f3a
status: at-risk
status_since: 2026-09-20
owner: "[[Priya Nair]]"
team: Payments
target: 2026-11-15
last_seen: 2026-09-23
sources: 14
---
# Payments Revamp

<!-- cubbon:begin summary -->
Replacing the legacy checkout with the new ledger service. Beta scope cut to cards only on 2026-09-12.
<!-- cubbon:end summary -->

## Status log
<!-- cubbon:begin status -->
- 2026-09-20 · **at-risk** · Beta slipped from Oct 15 to Nov 15 · [[Sources/sprint-2026-09-20]] · 0.92
- 2026-09-12 · scope cut: wallets deferred to Phase 2 · [[Decisions/Defer wallets to Phase 2]]
- 2026-08-01 · **on-track** · beta committed for Oct 15 · [[Sources/roadmap-q4]] · 0.88
<!-- cubbon:end status -->

## Milestones
<!-- cubbon:begin milestones -->
- [[Milestones/Payments Revamp – Beta]] · 2026-11-15 (was 2026-10-15) · at-risk
- [[Milestones/Payments Revamp – GA]] · 2027-01 · planned
<!-- cubbon:end milestones -->

## Blockers
<!-- cubbon:begin blockers -->
- [[Blockers/Stripe webhook retries]] · open since 2026-09-08 · owner [[Dev Shah]]
<!-- cubbon:end blockers -->

## Open commitments
<!-- cubbon:begin commitments -->
- [ ] Priya to send revised beta plan to Finance · due 2026-09-27 · [[Sources/email-2026-09-22-finance]]
<!-- cubbon:end commitments -->

## Decisions
<!-- cubbon:begin decisions -->
- 2026-09-12 · [[Decisions/Defer wallets to Phase 2]] · rationale: beta risk
<!-- cubbon:end decisions -->

## Dependencies and links
<!-- cubbon:begin links -->
- depends on [[Projects/Ledger Service]]
- shares owner with [[Projects/Fraud Rules v2]]
- JIRA PAY-412 · Figma checkout-v3 · [[Organizations/Stripe]]
<!-- cubbon:end links -->

## Open questions
<!-- cubbon:begin questions -->
- Roadmap still says Oct 15; sprint note says Nov 15. Kept Nov 15 (newer, same authority). Confirm in [[review]].
<!-- cubbon:end questions -->

## Notes
Anything written here is yours and is never touched by Cubbon.
```

### B. Day page template

```markdown
---
type: day
date: 2026-09-20
---
# 2026-09-20
- [[Projects/Payments Revamp]] → at-risk · beta slipped Oct 15 → Nov 15 · [[Sources/sprint-2026-09-20]]
- [[Blockers/Stripe webhook retries]] still open, 12 days · [[Sources/sprint-2026-09-20]]
- [[Projects/Fraud Rules v2]] → on-track · [[Sources/fraud-weekly-09-20]]
- Decision reaffirmed: [[Decisions/Defer wallets to Phase 2]]
```

### C. Review queue item shapes

```markdown
## Proposed merges
- [ ] "the webhook thing" (3 mentions) is [[Blockers/Stripe webhook retries]] · confidence 0.71 · sources: [[Sources/webex-2026-09-19]]

## Ambiguous dates
- [ ] [[Projects/Fraud Rules v2]] "ship by end of quarter" resolved to 2026-12-31 from doc date 2026-09-15 · confirm or edit the date

## Conflicts
- [ ] [[Milestones/Payments Revamp – Beta]] target: roadmap-q4 says 2026-10-15, sprint-2026-09-20 says 2026-11-15 · kept 2026-11-15

## Commitment closures
- [ ] "send revised beta plan to Finance" appears done per [[Sources/email-2026-09-24-finance]] ("attached the plan") · confidence 0.66
```

### D. Claim record

```json
{
  "id": "clm_3c9e…",
  "subject": "prj_7f3a",
  "predicate": "status",
  "object": "at-risk",
  "valid_from": "2026-09-20",
  "recorded_at": "2026-09-20",
  "ingested_at": "2026-09-21T08:14:02Z",
  "source_hash": "sha256:…",
  "span": { "start": 1420, "end": 1588 },
  "confidence": 0.92,
  "authority": 0.6,
  "extractor_version": "0.1.3",
  "model": "gpt-4.1-mini"
}
```

### E. MCP tool signatures

```
search(query, limit?)                         → notes with snippets and paths
get_entity(id_or_name)                        → frontmatter plus generated sections
what_changed(since, until?, project?)         → status changes, slips, blockers, decisions, commitments
timeline(project?, from?, to?)                → dated events in valid time
blockers(open_only?, project?)                → blockers with age and owner
commitments(owner?, status?, overdue_only?)   → commitments with sources
explain(claim_id)                             → source path, span text, confidence, authority
sources(entity_id)                            → source notes supporting the entity
review_queue()                                → pending items
```

### F. CLI reference

```
cubbon init [--vault PATH] [--watch DIR ...] [--exclude GLOB ...]
cubbon compile [--full] [--since DATE] [--dry-run]
cubbon watch
cubbon serve [--http PORT]
cubbon status
cubbon review [--open]
cubbon doctor
cubbon export [--cognee URL] [--json PATH]
cubbon pause | resume
```

### G. Glossary

- **Claim**: one dated, sourced fact extracted from one document.
- **Valid time**: when a fact was true or is due, from the document's content.
- **Recorded time**: the document's own date.
- **Authority**: how much a source type is trusted in conflicts.
- **Generated block**: a fenced region of a note that Cubbon owns and rewrites.
- **Review queue**: the note where Cubbon asks the user to confirm, correct or reject.
