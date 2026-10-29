import { it, expect, vi } from 'vitest';
import { ChatService } from '../src/chat/service';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona, defaultSettings } from '../src/domain/models';
import { Diagnostics } from '../src/storage/diagnostics';
import type { LLMProvider } from '../src/providers/provider';
async function setup(decision: unknown) {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    state: { energy: 0.7, relationshipCloseness: 0.5, recentFocus: [], curiosityTopics: [] },
    createdAt: 1,
  });
  await store.put('settings', { ...defaultSettings('c'), proactiveEnabled: true });
  const chat = vi.fn().mockResolvedValue({ content: JSON.stringify(decision), usage: {} });
  const streamChat = vi
    .fn()
    .mockResolvedValue({ content: '{"messages":["那就这么定了"]}', usage: {} });
  const afterRound = vi.fn();
  const service = new ChatService(
    store,
    async () => ({ chat, streamChat }) as unknown as LLMProvider,
    new Diagnostics(store),
    { retrieve: async () => [], afterRound },
    async () => {},
  );
  return { store, service, chat, streamChat, afterRound };
}
it('all input shapes reach the context decision; listen creates no reply or automatic reconnect', async () => {
  const r = await setup({ action: 'listen' });
  for (const input of ['。', '好', '我先想想刚才的事情', '今天的事情差不多就这些'])
    await r.service.send('c', input, () => {});
  expect(r.chat).toHaveBeenCalledTimes(4);
  expect(r.streamChat).not.toHaveBeenCalled();
  expect(await r.store.list('intentions', 'c')).toHaveLength(0);
  expect((await r.service.history('c')).every((m) => m.replyDisposition === 'silence')).toBe(true);
  expect(r.afterRound).toHaveBeenCalledTimes(4);
});
it('the same text can receive a response when the contextual decision differs', async () => {
  const r = await setup({ action: 'listen' });
  await r.service.send('c', '好', () => {});
  await r.store.put('messages', {
    id: 'q',
    characterId: 'c',
    role: 'assistant',
    content: '明天下午一起看那个比赛？',
    createdAt: Date.now() + 1,
    origin: 'chat',
    status: 'complete',
  });
  r.chat.mockResolvedValueOnce({ content: '{"action":"reply"}', usage: {} });
  await r.service.send('c', '好', () => {});
  expect(JSON.stringify(r.chat.mock.calls[1][0])).toContain('明天下午一起看那个比赛');
  expect(r.streamChat).toHaveBeenCalledOnce();
});
it('defer saves a concrete intention even without an immediate reply', async () => {
  const r = await setup({
    action: 'defer',
    thought: { topic: '刚才的比赛结果', reason: '还想整理一下对最后一局的看法', afterMinutes: 3 },
  });
  await r.service.send('c', '最后那局太突然了', () => {});
  expect(r.streamChat).not.toHaveBeenCalled();
  expect((await r.store.list('intentions', 'c'))[0]).toMatchObject({
    type: 'continuation',
    status: 'pending',
    topic: '刚才的比赛结果',
  });
  expect((await r.service.history('c'))[0].replyDisposition).toBe('silence');
});
it('invalid admission is a retryable failure and never forces response generation', async () => {
  const r = await setup({ action: 'unknown' });
  await expect(r.service.send('c', 'help', () => {})).rejects.toThrow();
  expect(r.streamChat).not.toHaveBeenCalled();
  expect((await r.service.history('c'))[0].status).toBe('error');
});
it('disabled initiative prevents a deferred thought from scheduling a background message', async () => {
  const r = await setup({
    action: 'defer',
    thought: { topic: '刚才的比赛结果', reason: '稍后再考虑这个具体想法', afterMinutes: 3 },
  });
  await r.store.put('settings', defaultSettings('c'));
  await r.service.send('c', '最后那局太突然了', () => {});
  expect(await r.store.list('intentions', 'c')).toHaveLength(0);
});
it('pause persists across restart and cancels pending contact without a confirmation bubble', async () => {
  const r = await setup({ action: 'pause' });
  await r.store.put('intentions', {
    id: 'old',
    characterId: 'c',
    type: 'requested',
    topic: 'later',
    reason: 'previous request',
    earliestAt: 1,
    latestAt: Date.now() + 999999,
    importance: 1,
    status: 'pending',
    createdAt: 1,
  });
  await r.service.send('c', '先让我安静待会', () => {});
  expect((await r.store.get('characters', 'c'))?.state.contactMode).toBe('quiet');
  expect((await r.store.get('intentions', 'old'))?.status).toBe('cancelled');
  expect((await r.service.history('c')).filter((m) => m.role === 'assistant')).toEqual([]);
  const { autonomousBlock } = await import('../src/proactive/reconnect');
  expect(await autonomousBlock(r.store, 'c', [], Date.now() + 999999)).toBe('user_wants_space');
  await r.service.recoverInterrupted('c');
  expect((await r.store.get('characters', 'c'))?.state.contactMode).toBe('quiet');
});
it('delivery review can reject generated narration without a lexical filter or replacement message', async () => {
  const r = await setup({ action: 'reply' });
  r.streamChat.mockResolvedValueOnce({ content: '{"messages":["（安静）"]}', usage: {} });
  r.chat
    .mockResolvedValueOnce({ content: '{"action":"reply"}', usage: {} })
    .mockResolvedValueOnce({ content: '{"action":"pause"}', usage: {} });
  await r.service.send('c', '你不用再回了', () => {});
  expect(r.streamChat).toHaveBeenCalledOnce();
  expect((await r.service.history('c')).filter((m) => m.role === 'assistant')).toEqual([]);
  expect((await r.store.get('characters', 'c'))?.state.contactMode).toBe('quiet');
});
it('a substantive new request can reopen contact after quiet, only after approved delivery', async () => {
  const r = await setup({ action: 'pause' });
  await r.service.send('c', '先不说了', () => {});
  r.chat.mockResolvedValue({ content: '{"action":"reply"}', usage: {} });
  await r.service.send('c', '可以说话了，明天的事怎么安排？', () => {});
  expect((await r.store.get('characters', 'c'))?.state.contactMode).toBe('open');
  expect((await r.service.history('c')).filter((m) => m.role === 'assistant')).toHaveLength(1);
});
it('presents old roleplay messages as transcript data, never as assistant continuation examples', async () => {
  const { decideParticipation } = await import('../src/chat/participation');
  const chat = vi.fn().mockResolvedValue({ content: '{"action":"listen"}', usage: {} });
  await decideParticipation({ chat } as unknown as LLMProvider, 'context', [
    { role: 'assistant', content: '（安静）' },
    { role: 'user', content: '嗯' },
  ]);
  const turns = chat.mock.calls[0][0];
  expect(turns.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  expect(JSON.parse(turns[1].content).transcriptForClassification[0].content).toBe('（安静）');
});
it('enables DeepSeek JSON mode for both control calls without imposing it on other providers', async () => {
  const { OpenAICompatibleProvider } = await import('../src/providers/openai');
  const { deepSeekPreset } = await import('../src/providers/provider');
  for (const host of ['https://api.deepseek.com', 'https://example.org/v1']) {
    const bodies: Record<string, unknown>[] = [];
    const provider = new OpenAICompatibleProvider(
      { ...deepSeekPreset, baseUrl: host },
      { get: async () => 'fixture-key', set: async () => {}, remove: async () => {} },
      async () => {},
      async (_url, options) => {
        bodies.push(JSON.parse(String(options?.body)));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"action":"listen"}' } }] }),
        );
      },
    );
    for (const purpose of ['conversation_participation', 'conversation_delivery_review'])
      await provider.chat([], purpose);
    for (const body of bodies) {
      expect(body.max_tokens).toBe(250);
      expect(body.response_format).toEqual(
        host.includes('deepseek') ? { type: 'json_object' } : undefined,
      );
    }
  }
});
