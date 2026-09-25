# ADR-005 Provider abstraction with recorded cassettes

Status: accepted (week 0, 2026-09-25)

## Decision

A `Provider` interface exposes `complete(request)` for structured output validated with zod. Implementations: Anthropic (forced tool call, one repair round), Ollama (`/api/chat` with a JSON schema `format`), Fake (tests). `CassetteProvider` wraps any provider and records or replays responses keyed by a hash of system prompt, user message, schema name and schema (model excluded, so a model upgrade replays the same cassette until re-recorded).

## Consequences

- Unit and golden tests run without network or keys. Cassette misses in replay mode fail loudly.
- Cost is estimated from a small price table; unknown models record `costUsd: null` and are counted separately in the spend summary.
