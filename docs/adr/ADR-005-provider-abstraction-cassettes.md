# ADR-005 Provider abstraction with recorded cassettes

Status: accepted (week 0, 2026-09-25)

## Decision

A `Provider` interface exposes `complete(request)` for structured output validated with zod. Implementations: OpenAI-compatible Chat Completions (the default; `response_format: json_schema`, downgraded to `json_object` with the schema in the prompt when a server rejects it, one repair round on validation failure), Ollama (`/api/chat` with a JSON schema `format`), Fake (tests).

The OpenAI-compatible provider is the only hosted one for now. It is implemented over plain `fetch` with a configurable base URL so the same code serves OpenAI, OpenRouter, Groq, Ollama's `/v1`, LM Studio and vLLM. An API key is mandatory only for `api.openai.com`; other endpoints surface their own 401 as an `auth` error. A native Anthropic provider can be added later behind the same interface. `CassetteProvider` wraps any provider and records or replays responses keyed by a hash of system prompt, user message, schema name and schema (model excluded, so a model upgrade replays the same cassette until re-recorded).

## Consequences

- Unit and golden tests run without network or keys. Cassette misses in replay mode fail loudly.
- Cost is estimated from a small price table; unknown models record `costUsd: null` and are counted separately in the spend summary.
