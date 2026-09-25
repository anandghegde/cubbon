import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { z } from 'zod';
import { ExtractionOutputSchema } from '../src/extract/schema.ts';
import { CassetteProvider } from '../src/llm/cassette.ts';
import { FakeProvider } from '../src/llm/fake.ts';
import { toJsonSchema } from '../src/llm/jsonschema.ts';
import { OpenAIProvider } from '../src/llm/openai.ts';
import { estimateCost } from '../src/llm/pricing.ts';
import { ProviderError } from '../src/llm/types.ts';
import { tempDir } from './helpers.ts';

const schema = z.object({ answer: z.string() });
const req = { purpose: 'test', system: 's', user: 'u', schema, schemaName: 'answer' };

describe('cassettes', () => {
  test('record then replay, and replay misses fail loudly', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      let calls = 0;
      const live = new FakeProvider(() => {
        calls += 1;
        return { answer: `live ${calls}` };
      });
      const rec = new CassetteProvider(live, path.join(dir, 'c'), 'auto');
      expect((await rec.complete(req)).data.answer).toBe('live 1');
      const second = await rec.complete(req);
      expect(second.data.answer).toBe('live 1');
      expect(second.fromCassette).toBe(true);
      expect(calls).toBe(1);
      const replayOnly = new CassetteProvider(null, path.join(dir, 'c'), 'replay');
      expect((await replayOnly.complete(req)).data.answer).toBe('live 1');
      await expect(replayOnly.complete({ ...req, user: 'other' })).rejects.toBeInstanceOf(
        ProviderError,
      );
      const rerecord = new CassetteProvider(live, path.join(dir, 'c'), 'record');
      expect((await rerecord.complete(req)).data.answer).toBe('live 2');
    } finally {
      await cleanup();
    }
  });
});

describe('schema and pricing', () => {
  test('extraction schema converts to json schema with a discriminated object union', () => {
    const js = toJsonSchema(ExtractionOutputSchema) as {
      type: string;
      properties: Record<string, unknown>;
      $schema?: string;
    };
    expect(js.type).toBe('object');
    expect(Object.keys(js.properties)).toEqual([
      'entities',
      'claims',
      'unresolved_dates',
      'open_questions',
    ]);
    expect(js.$schema).toBeUndefined();
    expect(JSON.stringify(js)).toContain('"at-risk"');
  });
  test('fake provider validates output', async () => {
    const bad = new FakeProvider(() => ({ nope: 1 }));
    await expect(bad.complete(req)).rejects.toThrow();
  });
  test('cost uses the longest matching prefix, gateway vendor prefixes, and null for unknown', () => {
    expect(
      estimateCost('gpt-4.1-mini-2025-04-14', { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(0.4);
    expect(estimateCost('gpt-4.1', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2);
    expect(estimateCost('openai/gpt-4o-mini', { inputTokens: 0, outputTokens: 1_000_000 })).toBe(
      0.6,
    );
    expect(
      estimateCost('claude-haiku-4-5-20251001', { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(1);
    expect(estimateCost('llama3.2', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});

type Handler = (body: Record<string, unknown>, n: number) => Response;

function mockServer(handler: Handler) {
  let calls = 0;
  const bodies: Record<string, unknown>[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/v1/models') {
        return Response.json({ data: [{ id: 'test-model' }] });
      }
      if (url.pathname !== '/v1/chat/completions') return new Response('nope', { status: 404 });
      calls += 1;
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return handler(body, calls);
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    bodies,
    calls: () => calls,
    stop: () => server.stop(true),
  };
}

function completion(content: string, usage = { prompt_tokens: 10, completion_tokens: 5 }) {
  return Response.json({
    model: 'test-model',
    choices: [{ message: { role: 'assistant', content } }],
    usage,
  });
}

function provider(baseUrl: string, apiKey?: string) {
  return new OpenAIProvider('test-model', { baseUrl, apiKey, maxRetries: 1, retryBaseMs: 1 });
}

describe('openai-compatible provider', () => {
  test('sends json_schema response_format and sums usage', async () => {
    const srv = mockServer(() => completion('{"answer":"42"}'));
    try {
      const res = await provider(srv.baseUrl, 'sk-test').complete(req);
      expect(res.data).toEqual({ answer: '42' });
      expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
      expect(res.provider).toBe('openai');
      expect(res.model).toBe('test-model');
      expect(res.fromCassette).toBe(false);
      const body = srv.bodies[0] as {
        messages: { role: string; content: string }[];
        response_format: { type: string; json_schema: { name: string; schema: unknown } };
        max_tokens: number;
        temperature: number;
      };
      expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.name).toBe('answer');
      expect(body.max_tokens).toBe(8192);
      expect(body.temperature).toBe(0);
    } finally {
      srv.stop();
    }
  });

  test('strips code fences and repairs once on validation failure', async () => {
    const srv = mockServer((_body, n) =>
      n === 1 ? completion('```json\n{"answer": 7}\n```') : completion('{"answer":"seven"}'),
    );
    try {
      const res = await provider(srv.baseUrl).complete(req);
      expect(res.data.answer).toBe('seven');
      expect(srv.calls()).toBe(2);
      const repair = srv.bodies[1] as { messages: { role: string; content: string }[] };
      expect(repair.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
      expect(repair.messages[3]?.content).toContain('answer');
      expect(res.usage.inputTokens).toBe(20);
    } finally {
      srv.stop();
    }
  });

  test('gives up after the repair round', async () => {
    const srv = mockServer(() => completion('{"answer": 1}'));
    try {
      await expect(provider(srv.baseUrl).complete(req)).rejects.toMatchObject({
        kind: 'validation',
      });
      expect(srv.calls()).toBe(2);
    } finally {
      srv.stop();
    }
  });

  test('falls back to json_object with the schema in the prompt when json_schema is rejected', async () => {
    const srv = mockServer((body) =>
      (body.response_format as { type: string }).type === 'json_schema'
        ? Response.json(
            { error: { message: 'response_format json_schema not supported' } },
            { status: 400 },
          )
        : completion('{"answer":"ok"}'),
    );
    try {
      const p = provider(srv.baseUrl);
      expect((await p.complete(req)).data.answer).toBe('ok');
      expect(srv.calls()).toBe(2);
      const second = srv.bodies[1] as {
        response_format: { type: string };
        messages: { content: string }[];
      };
      expect(second.response_format).toEqual({ type: 'json_object' });
      expect(second.messages[0]?.content).toContain('JSON Schema');
      // The downgrade sticks for later calls on the same provider.
      expect((await p.complete(req)).data.answer).toBe('ok');
      expect(srv.calls()).toBe(3);
    } finally {
      srv.stop();
    }
  });

  test('classifies auth and rate limit errors and retries transport failures', async () => {
    const auth = mockServer(() => new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    const rate = mockServer(() => new Response('slow down', { status: 429 }));
    const flaky = mockServer((_body, n) =>
      n === 1 ? new Response('boom', { status: 503 }) : completion('{"answer":"recovered"}'),
    );
    try {
      await expect(provider(auth.baseUrl, 'bad').complete(req)).rejects.toMatchObject({
        kind: 'auth',
      });
      await expect(provider(rate.baseUrl).complete(req)).rejects.toMatchObject({
        kind: 'rate_limit',
      });
      expect(rate.calls()).toBe(2);
      expect((await provider(flaky.baseUrl).complete(req)).data.answer).toBe('recovered');
      expect(flaky.calls()).toBe(2);
    } finally {
      auth.stop();
      rate.stop();
      flaky.stop();
    }
  });

  test('omits the bearer header without a key and probes the models endpoint', async () => {
    let authHeader: string | null = 'unset';
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        authHeader = request.headers.get('authorization');
        return Response.json({ data: [{ id: 'other-model' }] });
      },
    });
    try {
      const p = new OpenAIProvider('test-model', {
        baseUrl: `http://127.0.0.1:${server.port}/v1/`,
      });
      const probe = await p.probe();
      expect(authHeader).toBeNull();
      expect(probe.ok).toBe(false);
      expect(probe.detail).toContain('not listed');
    } finally {
      server.stop(true);
    }
  });
});
