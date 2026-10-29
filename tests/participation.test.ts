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
it('invalid/failed admission falls back to normal generation rather than discarding a request', async () => {
  const r = await setup({ action: 'unknown' });
  await r.service.send('c', '帮我看看这个问题', () => {});
  expect(r.streamChat).toHaveBeenCalledOnce();
  expect(
    (await r.store.list('diagnostics', 'c')).some(
      (d) => d.data.operation === 'participation_fallback',
    ),
  ).toBe(true);
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
