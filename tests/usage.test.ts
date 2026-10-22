import { it, expect } from 'vitest';
import { UsageLedger, normalizeUsage, estimateCost, type TokenPrice } from '../src/usage/ledger';
import { migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import type { ApiMetric } from '../src/providers/provider';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset } from '../src/providers/provider';
const price: TokenPrice = {
  currency: 'CNY',
  inputPerMillion: 2,
  cachedInputPerMillion: 0.04,
  outputPerMillion: 8,
  label: 'fixture',
};
const metric: ApiMetric = {
  requestId: 'r',
  startedAt: 100,
  endpoint: 'https://example.org/v1',
  model: 'fixture',
  purpose: 'chat',
  duration: 100,
  success: true,
  inputTokens: 1000,
  outputTokens: 500,
  cachedInputTokens: 600,
};
it('normalizes DeepSeek and compatible cached token fields without counting cache twice', () => {
  expect(
    normalizeUsage({ prompt_tokens: 1000, completion_tokens: 500, prompt_cache_hit_tokens: 600 }),
  ).toEqual({ inputTokens: 1000, outputTokens: 500, cachedInputTokens: 600 });
  expect(
    normalizeUsage({ prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 600 } })
      .cachedInputTokens,
  ).toBe(600);
  expect(
    normalizeUsage({ prompt_tokens: 1000, prompt_cache_miss_tokens: 400 }).cachedInputTokens,
  ).toBe(600);
  expect(normalizeUsage({ prompt_tokens: -1, completion_tokens: '500' })).toEqual({});
  expect(
    normalizeUsage({ prompt_tokens: 10, prompt_cache_hit_tokens: 99 }).cachedInputTokens,
  ).toBeUndefined();
  expect(estimateCost(metric, price)).toBeCloseTo(0.004824, 8);
  expect(estimateCost({ inputTokens: 1000 }, price)).toBeUndefined();
  expect(estimateCost({ inputTokens: 1000, outputTokens: 500 }, price)).toBeUndefined();
});
it('keeps durable usage, historical price snapshots, request idempotence and currencies separate', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const ledger = new UsageLedger(db);
  await ledger.setPrice(metric.endpoint, metric.model, price);
  await ledger.record(metric, await ledger.price(metric.endpoint, metric.model));
  await ledger.record(metric, price);
  await ledger.setPrice(metric.endpoint, metric.model, { ...price, inputPerMillion: 999 });
  await ledger.record(
    {
      ...metric,
      requestId: 'unknown',
      success: false,
      inputTokens: undefined,
      outputTokens: undefined,
    },
    price,
  );
  await ledger.record(
    { ...metric, requestId: 'usd', startedAt: 200 },
    { ...price, currency: 'USD' },
  );
  const fresh = new UsageLedger(db);
  const rows = await fresh.summary();
  const cny = rows.find((r) => r.currency === 'CNY')!;
  expect(cny.requests).toBe(2);
  expect(cny.unknownUsage).toBe(1);
  expect(cny.unpriced).toBe(1);
  expect(cny.estimatedCost).toBeCloseTo(0.004824);
  expect(rows).toHaveLength(2);
  expect((await fresh.summary(150))[0].currency).toBe('USD');
  expect((await fresh.recent()).find((r) => r.requestId === 'r')?.price).toEqual(price);
});
it('records a failed truncated stream exactly once and preserves usage already received', async () => {
  const metrics: ApiMetric[] = [];
  const provider = new OpenAICompatibleProvider(
    deepSeekPreset,
    { get: async () => 'fixture', set: async () => {}, remove: async () => {} },
    async (m) => {
      metrics.push(m);
    },
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                'data: {"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_cache_hit_tokens":10}}\n\ndata: malformed\n\n',
              ),
            );
            c.close();
          },
        }),
      ),
  );
  await expect(provider.streamChat([], () => {})).rejects.toThrow();
  expect(metrics).toHaveLength(1);
  expect(metrics[0].success).toBe(false);
  expect(metrics[0].inputTokens).toBe(100);
  expect(metrics[0].outputTokens).toBe(20);
});
it('does not turn a successful paid response into a retry if accounting storage fails', async () => {
  const provider = new OpenAICompatibleProvider(
    deepSeekPreset,
    { get: async () => 'fixture', set: async () => {}, remove: async () => {} },
    async () => {
      throw new Error('disk full');
    },
    async () =>
      Response.json({
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
  );
  expect((await provider.chat([], 'test')).content).toBe('OK');
});
