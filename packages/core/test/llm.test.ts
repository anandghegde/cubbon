import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { z } from 'zod';
import { ExtractionOutputSchema } from '../src/extract/schema.ts';
import { CassetteProvider } from '../src/llm/cassette.ts';
import { FakeProvider } from '../src/llm/fake.ts';
import { toJsonSchema } from '../src/llm/jsonschema.ts';
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
  test('cost is null for unknown models', () => {
    expect(
      estimateCost('claude-haiku-4-5-20251001', { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(1);
    expect(estimateCost('claude-fable-5-1', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});
