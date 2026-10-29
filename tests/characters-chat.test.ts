import { expect, it } from 'vitest';
import { CharacterService, defaultAnswers } from '../src/characters/service';
import { ChatService, parseReply, streamingPreview } from '../src/chat/service';
import { buildChatPrompt, characterVoice } from '../src/chat/prompt';
import { demoPersona } from '../src/domain/models';
import { Diagnostics } from '../src/storage/diagnostics';
import { migrate, SQLiteStore } from '../src/storage/store';
import type { LLMProvider } from '../src/providers/provider';
import { TestDatabase } from './database';
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  return new SQLiteStore(db);
}
const fake: LLMProvider = {
  chat: async () => ({ content: JSON.stringify({ action: 'reply' }), usage: {} }),
  streamChat: async (_, onDelta) => {
    const content = '{"messages":["又咋了","谁又惹你了"]}';
    onDelta(content.slice(0, 20));
    onDelta(content.slice(20));
    return { content, usage: {} };
  },
  structuredOutput: async (_, schema) => schema.parse(demoPersona('model-id')),
};
it('generates and persists a persona under a device-owned id', async () => {
  const store = await setup();
  const character = await new CharacterService(store, async () => fake).create({
    ...defaultAnswers,
    name: '小桶',
  });
  expect(character.id).not.toBe('model-id');
  expect(character.persona.id).toBe(character.id);
  expect((await store.get('characters', character.id))?.persona.name).toBe('小桶');
  expect((await store.get('settings', character.id))?.proactiveEnabled).toBe(true);
});
it('streams, persists multiple messages and schedules post-round work', async () => {
  const store = await setup();
  const c = await new CharacterService(store, async () => fake).create(
    { ...defaultAnswers, name: '桶砸' },
    true,
  );
  let rounds = 0;
  const previews: string[] = [];
  const pauses: number[] = [];
  const service = new ChatService(
    store,
    async () => fake,
    new Diagnostics(store),
    {
      retrieve: async () => [],
      afterRound: async () => {
        rounds++;
      },
    },
    async (ms) => {
      pauses.push(ms);
    },
  );
  await service.send(c.id, '今天上班烦死了', (p) => previews.push(p));
  const history = await service.history(c.id);
  expect(history.map((m) => m.content)).toEqual(['今天上班烦死了', '又咋了', '谁又惹你了']);
  expect(previews.some((p) => p.includes('又咋了'))).toBe(true);
  expect(previews.every((p) => !p.includes('messages'))).toBe(true);
  expect(pauses[0]).toBeGreaterThanOrEqual(300);
  expect(pauses[0]).toBeLessThanOrEqual(1500);
  expect(rounds).toBe(1);
});
it('keeps an errored user message retryable without duplicating it', async () => {
  const store = await setup();
  const c = await new CharacterService(store, async () => fake).create(
    { ...defaultAnswers, name: '桶' },
    true,
  );
  const broken = {
    ...fake,
    streamChat: async () => {
      throw new Error('offline');
    },
  };
  await expect(
    new ChatService(store, async () => broken, new Diagnostics(store)).send(
      c.id,
      '你好呀',
      () => {},
    ),
  ).rejects.toThrow();
  const user = (await store.list('messages', c.id))[0];
  expect(user.status).toBe('error');
  await new ChatService(
    store,
    async () => fake,
    new Diagnostics(store),
    undefined,
    async () => {},
  ).send(
    c.id,
    user.content,
    () => {},
    () => {},
    undefined,
    user.id,
  );
  expect((await store.list('messages', c.id)).filter((m) => m.role === 'user')).toHaveLength(1);
});
it('bounds history and never renders JSON control syntax as a preview', async () => {
  const store = await setup();
  const c = await new CharacterService(store, async () => fake).create(
    { ...defaultAnswers, name: '桶' },
    true,
  );
  const history = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    characterId: c.id,
    role: 'user' as const,
    content: 'x'.repeat(3000),
    createdAt: i,
    status: 'complete' as const,
    origin: 'chat' as const,
  }));
  const prompt = buildChatPrompt(c, history, []);
  expect(prompt).toHaveLength(17);
  expect(prompt[1].content).toHaveLength(2000);
  expect(streamingPreview('{"messages":["诶')).toBe('诶');
  expect(parseReply('就一句')).toEqual(['就一句']);
  expect(() => parseReply('{"messages":')).toThrow();
});
it('does not mark a delivered chat as retryable when background analysis fails', async () => {
  const store = await setup();
  const c = await new CharacterService(store, async () => fake).create(
    { ...defaultAnswers, name: '桶' },
    true,
  );
  const service = new ChatService(
    store,
    async () => fake,
    new Diagnostics(store),
    {
      retrieve: async () => [],
      afterRound: async () => {
        throw new Error('extraction offline');
      },
    },
    async () => {},
  );
  await service.send(c.id, '聊一会儿', () => {});
  expect((await store.list('messages', c.id)).every((m) => m.status === 'complete')).toBe(true);
  expect(
    (await store.list('diagnostics', c.id)).some((d) => d.data.operation === 'post_round'),
  ).toBe(true);
});
it('recovers an interrupted request and durably saved multi-part replies after process restart', async () => {
  const store = await setup();
  const service = new ChatService(store, async () => fake, new Diagnostics(store));
  await store.put('messages', {
    id: 'pending-user',
    characterId: 'c',
    role: 'user',
    content: '未收到回复',
    status: 'pending',
    origin: 'chat',
    createdAt: 1,
  });
  await store.put('messages', {
    id: 'u-done',
    characterId: 'c',
    role: 'user',
    content: '已生成回复',
    status: 'complete',
    origin: 'chat',
    createdAt: 2,
  });
  await store.put('messages', {
    id: 'a-pending',
    characterId: 'c',
    role: 'assistant',
    content: '已在磁盘上的第二段',
    status: 'pending',
    origin: 'chat',
    createdAt: 3,
    groupId: 'u-done',
  });
  await service.recoverInterrupted('c');
  expect((await store.get('messages', 'pending-user'))?.status).toBe('error');
  expect((await store.get('messages', 'a-pending'))?.status).toBe('complete');
  expect((await service.history('c')).map((m) => m.content)).toContain('已在磁盘上的第二段');
});
it('paginates local history without growing the model context', async () => {
  const store = await setup();
  const service = new ChatService(store, async () => fake, new Diagnostics(store));
  for (let n = 0; n < 120; n++)
    await store.put('messages', {
      id: String(n),
      characterId: 'c',
      role: 'user',
      content: String(n),
      status: 'complete',
      origin: 'chat',
      createdAt: n,
    });
  expect((await service.historyPage('c', 100)).hasMore).toBe(true);
  expect((await service.historyPage('c', 200)).messages).toHaveLength(120);
});
it('rejects a retry targeting another character without modifying that message', async () => {
  const store = await setup();
  const c = await new CharacterService(store, async () => fake).create(
    { ...defaultAnswers, name: '桶' },
    true,
  );
  await store.put('messages', {
    id: 'foreign',
    characterId: 'other',
    role: 'user',
    content: 'private',
    status: 'complete',
    origin: 'chat',
    createdAt: 1,
  });
  const service = new ChatService(store, async () => fake, new Diagnostics(store));
  await expect(
    service.send(
      c.id,
      'private',
      () => {},
      () => {},
      undefined,
      'foreign',
    ),
  ).rejects.toThrow('不能重试');
  expect((await store.get('messages', 'foreign'))?.status).toBe('complete');
});

it('includes a retried old message after the bounded context window', async () => {
  const store = await setup();
  const c = await new CharacterService(store, async () => fake).create(
    { ...defaultAnswers, name: '桶' },
    true,
  );
  for (let n = 0; n < 120; n++)
    await store.put('messages', {
      id: String(n),
      characterId: c.id,
      role: 'user',
      content: n === 0 ? '很早以前失败的消息' : String(n),
      createdAt: n,
      status: n === 0 ? 'error' : 'complete',
      origin: 'chat',
    });
  let finalRequest = '';
  const provider: LLMProvider = {
    ...fake,
    streamChat: async (prompt, onDelta, signal) => {
      finalRequest = prompt.at(-1)!.content;
      expect(prompt.length).toBeLessThanOrEqual(17);
      return fake.streamChat(prompt, onDelta, signal);
    },
  };
  await new ChatService(
    store,
    async () => provider,
    new Diagnostics(store),
    undefined,
    async () => {},
  ).send(
    c.id,
    '很早以前失败的消息',
    () => {},
    () => {},
    undefined,
    '0',
  );
  expect(finalRequest).toBe('很早以前失败的消息');
  expect(
    (await store.list('messages', c.id, 200)).filter((m) => m.content === finalRequest),
  ).toHaveLength(1);
});

it('keeps partial and incomplete multi-part responses out of visible history', async () => {
  const store = await setup();
  const c = await new CharacterService(store, async () => fake).create(
    { ...defaultAnswers, name: '桶' },
    true,
  );
  let service: ChatService;
  const visible: string[][] = [];
  const provider: LLMProvider = {
    ...fake,
    streamChat: async (_, onDelta) => {
      onDelta('{"messages":["半句');
      expect((await service.history(c.id)).filter((m) => m.role === 'assistant')).toHaveLength(0);
      onDelta('话","第二条"]}');
      expect((await service.history(c.id)).filter((m) => m.role === 'assistant')).toHaveLength(0);
      return { content: '{"messages":["半句话","第二条"]}', usage: {} };
    },
  };
  service = new ChatService(
    store,
    async () => provider,
    new Diagnostics(store),
    undefined,
    async () => {
      visible.push(
        (await service.history(c.id)).filter((m) => m.role === 'assistant').map((m) => m.content),
      );
    },
  );
  await service.send(c.id, '你好', () => {});
  expect(visible).toEqual([[], ['半句话']]);
  expect(
    (await service.history(c.id)).filter((m) => m.role === 'assistant').map((m) => m.content),
  ).toEqual(['半句话', '第二条']);
});

it('accepts intentional silence, keeps it complete after restart, and still extracts user preferences', async () => {
  const store = await setup();
  const c = await new CharacterService(store, async () => fake).create(
    { ...defaultAnswers, name: '桶砸' },
    true,
  );
  let calls = 0;
  const silent: LLMProvider = {
    ...fake,
    streamChat: async () => {
      calls++;
      return { content: '{"messages":[]}', usage: {} };
    },
  };
  const extracted: string[][] = [];
  const hooks = {
    retrieve: async () => [],
    afterRound: async (_: string, user: { content: string }, assistant: { content: string }[]) => {
      extracted.push([user.content, ...assistant.map((m) => m.content)]);
    },
  };
  const service = new ChatService(store, async () => silent, new Diagnostics(store), hooks);
  await service.send(c.id, '先别回，我还没说完', () => {});
  const history = await service.history(c.id);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    role: 'user',
    status: 'complete',
    replyDisposition: 'silence',
  });
  await new ChatService(
    store,
    async () => silent,
    new Diagnostics(store),
    hooks,
  ).recoverInterrupted(c.id);
  expect(calls).toBe(1);
  expect(extracted).toEqual([['先别回，我还没说完'], ['先别回，我还没说完']]);
  expect(parseReply('{"messages":["诶","我想到一个事","刚好跟你说的有关"]}')).toHaveLength(3);
  expect(() => parseReply('')).toThrow();
  expect(() => parseReply('{"messages":[""]}')).toThrow();
});

it('keeps an existing character voice without forcing a technical self-introduction', () => {
  const old = {
    ...demoPersona('old'),
    identity: '一个有自己喜好、嘴上随意但会记住小事的数字伙伴',
    portrait: undefined,
    dialogueExamples: undefined,
  };
  const before = JSON.stringify(old);
  const voice = characterVoice(old);
  expect(voice).not.toContain('数字伙伴');
  expect(voice).toContain('小众游戏');
  expect(voice).toContain('语气样本');
  expect(JSON.stringify(old)).toBe(before);
});
