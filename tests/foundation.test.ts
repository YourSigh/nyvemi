import { describe, it, expect } from 'vitest';
import { demoPersona, PersonaSchema } from '../src/domain/models';
import { migrate, SQLiteStore } from '../src/storage/store';
import { deepSeekPreset, validateProviderConfig } from '../src/providers/provider';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { TestDatabase } from './database';
describe('foundation', () => {
  it('serializes persona and migrates idempotently', async () => {
    const db = new TestDatabase();
    await migrate(db);
    await migrate(db);
    const store = new SQLiteStore(db);
    const p = demoPersona('one');
    await store.put('characters', {
      id: p.id,
      persona: p,
      state: { energy: 0.7, relationshipCloseness: 0.1, recentFocus: [], curiosityTopics: [] },
      interests: [],
      createdAt: 1,
    });
    expect(PersonaSchema.parse(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect((await store.get('characters', 'one'))?.persona).toEqual(p);
    await store.remove('characters', 'one');
    expect(await store.list('characters')).toEqual([]);
  });
  it('validates provider addresses without credential leaks', () => {
    expect(validateProviderConfig(deepSeekPreset)).toEqual(deepSeekPreset);
    for (const baseUrl of [
      'http://example.com',
      'https://user:secret@host.com',
      'https://host.com?key=secret',
      'file:///tmp/a',
    ])
      expect(() => validateProviderConfig({ ...deepSeekPreset, baseUrl })).toThrow();
    expect(
      validateProviderConfig({ ...deepSeekPreset, baseUrl: 'http://192.168.1.2:11434/v1' }).model,
    ).toBe('deepseek-flash');
  });
  it('redacts server responses and keys from errors', async () => {
    const metrics: unknown[] = [];
    const provider = new OpenAICompatibleProvider(
      deepSeekPreset,
      { get: async () => 'secret-test', set: async () => {}, remove: async () => {} },
      async (m) => {
        metrics.push(m);
      },
      async () => new Response('secret-test', { status: 401 }),
    );
    await expect(provider.chat([{ role: 'user', content: 'hi' }], 'test')).rejects.toThrow(
      'HTTP 401',
    );
    expect(JSON.stringify(metrics)).not.toContain('secret-test');
  });
  it('streams SSE split across network frames and records usage', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"诶"}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"咋了"}}]}\n\ndata: {"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
    ];
    const provider = new OpenAICompatibleProvider(
      deepSeekPreset,
      { get: async () => 'test', set: async () => {}, remove: async () => {} },
      async () => {},
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              chunks.forEach((s) => c.enqueue(encoder.encode(s)));
              c.close();
            },
          }),
        ),
    );
    let text = '';
    const r = await provider.streamChat([], (d) => {
      text += d;
    });
    expect(text).toBe('诶咋了');
    expect(r.usage).toEqual({ inputTokens: 2, outputTokens: 3 });
  });
});
it('redacts known credentials at the diagnostic storage boundary', async () => {
  const { Diagnostics } = await import('../src/storage/diagnostics');
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await new Diagnostics(store, async (json) =>
    json.split('known-fixture-secret').join('[REDACTED]'),
  ).record('prompt', 'c', { content: 'do not log known-fixture-secret' });
  const rows = await store.list('diagnostics');
  expect(JSON.stringify(rows)).not.toContain('known-fixture-secret');
  expect(JSON.stringify(rows)).toContain('[REDACTED]');
});
it('redacts quoted and short credentials in JSON string fields without corrupting numbers', async () => {
  const { redactKnownSecret } = await import('../src/domain/privacy');
  expect(redactKnownSecret({ text: 'a b"x c', at: 123 }, 'b"x')).toEqual({
    text: 'a [REDACTED] c',
    at: 123,
  });
  expect(redactKnownSecret({ text: 'x1y', at: 123 }, '1')).toEqual({
    text: 'x[REDACTED]y',
    at: 123,
  });
});
