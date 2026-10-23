import { expect, it } from 'vitest';
import { requestedDelay, queueRequestedMessage } from '../src/chat/delayed-request';
import { CharacterService, defaultAnswers } from '../src/characters/service';
import { ChatService } from '../src/chat/service';
import { defaultSettings, type Message, type NotificationRecord } from '../src/domain/models';
import { HeartbeatEngine, type NotificationGateway } from '../src/proactive/heartbeat/engine';
import type { LLMProvider } from '../src/providers/provider';
import { Diagnostics } from '../src/storage/diagnostics';
import { migrate, SQLiteStore } from '../src/storage/store';
import { TestDatabase } from './database';

const fake: LLMProvider = {
  chat: async () => ({ content: '', usage: {} }),
  streamChat: async () => {
    throw new Error('a scheduling acknowledgement must not come from the model');
  },
  structuredOutput: async (_, schema) =>
    schema.parse({ messages: ['我回来啦，刚才那件事你还想聊么'] }),
};
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const c = await new CharacterService(store, async () => fake).create(
    { ...defaultAnswers, name: '桶' },
    true,
  );
  const user: Message = {
    id: 'u',
    characterId: c.id,
    content: '一分钟后发一条你想发的消息给我',
    role: 'user',
    origin: 'chat',
    status: 'complete',
    createdAt: 1,
  };
  return { store, c, user };
}
it('recognizes direct relative requests without scheduling quoted, hypothetical or negative statements', () => {
  expect(requestedDelay('一分钟后发一条你想发的消息给我')).toBe(60000);
  expect(requestedDelay('请你30秒后给我发一条消息')).toBe(30000);
  expect(requestedDelay('半小时后找我聊聊')).toBe(1800000);
  expect(requestedDelay('十二分钟后发消息给我')).toBe(720000);
  for (const input of [
    '我下午一分钟后开会',
    '“一分钟后发消息给我”',
    '一分钟后不要发消息给我',
    '如果一分钟后发消息给我',
    '0分钟后发消息给我',
    '25小时后发消息给我',
    '一分钟后给你发消息',
  ])
    expect(requestedDelay(input)).toBeUndefined();
});
it('only acknowledges an armed, persisted request and retries without changing its deadline', async () => {
  const { store, user } = await setup();
  await expect(
    queueRequestedMessage(
      store,
      user,
      60000,
      async () => {
        throw new Error('permission');
      },
      100,
    ),
  ).rejects.toThrow('permission');
  expect(await store.list('intentions')).toHaveLength(0);
  const ack = await queueRequestedMessage(store, user, 60000, async () => {}, 100);
  expect(ack).toContain('记下了');
  await queueRequestedMessage(store, user, 60000, async () => {}, 1000);
  expect((await store.list('intentions'))[0].earliestAt).toBe(60100);
  expect(await store.list('intentions')).toHaveLength(1);
});
it('routes the exact reported chat request into the queue before showing its acknowledgement', async () => {
  const { store, c, user } = await setup();
  const service = new ChatService(store, async () => fake, new Diagnostics(store), {
    retrieve: async () => [],
    afterRound: async () => {},
    scheduleRequested: (request) => queueRequestedMessage(store, request, 60000, async () => {}),
  });
  await service.send(c.id, user.content, () => {});
  expect(await store.list('intentions')).toHaveLength(1);
  expect((await service.history(c.id)).at(-1)?.content).toContain('记下了');
});
it('does not claim success when Android delivery cannot be armed', async () => {
  const { store, c, user } = await setup();
  const service = new ChatService(store, async () => fake, new Diagnostics(store), {
    retrieve: async () => [],
    afterRound: async () => {},
    scheduleRequested: async () => {
      throw new Error('通知被关闭');
    },
  });
  await expect(service.send(c.id, user.content, () => {})).rejects.toThrow('通知被关闭');
  expect((await service.history(c.id)).map((m) => m.role)).toEqual(['user']);
  expect((await service.history(c.id))[0].status).toBe('error');
});
it('delivers a requested message despite recent active chat, quiet hours and disabled unsolicited messages, exactly once after restart', async () => {
  const { store, c, user } = await setup();
  let now = new Date(2026, 9, 23, 2).getTime();
  await store.put('settings', {
    ...defaultSettings(c.id),
    proactiveEnabled: false,
    lastActiveAt: now,
    dailyLimit: 0,
  });
  await queueRequestedMessage(store, user, 60000, async () => {}, now);
  let calls = 0;
  const delivered: NotificationRecord[] = [];
  const gateway: NotificationGateway = {
    enabled: async () => true,
    show: async (n) => {
      delivered.push(n);
    },
    cancel: async () => {},
  };
  const makeEngine = () =>
    new HeartbeatEngine(
      store,
      async () => {
        calls++;
        return fake;
      },
      gateway,
      new Diagnostics(store),
      () => now,
    );
  for (let n = 0; n < 12; n++) await makeEngine().runRequested();
  expect(calls).toBe(0);
  now += 60000;
  await makeEngine().runRequested();
  await makeEngine().runRequested();
  expect(calls).toBe(1);
  expect(delivered).toHaveLength(1);
  expect((await store.list('messages', c.id))[0].status).toBe('complete');
  expect((await store.list('intentions', c.id))[0].status).toBe('completed');
});
it('retries an undelivered outbox without generating again and applies API failure backoff', async () => {
  const { store, c, user } = await setup();
  let now = 1000000;
  await queueRequestedMessage(store, user, 10000, async () => {}, now - 10000);
  let calls = 0;
  let failures = true;
  const gateway: NotificationGateway = {
    enabled: async () => true,
    show: async () => {
      if (failures) throw new Error('OS');
    },
    cancel: async () => {},
  };
  const engine = new HeartbeatEngine(
    store,
    async () => {
      calls++;
      return fake;
    },
    gateway,
    new Diagnostics(store),
    () => now,
  );
  await engine.runRequested();
  await engine.runRequested();
  expect(calls).toBe(1);
  expect((await store.list('messages', c.id))[0].status).toBe('pending');
  failures = false;
  now += 60000;
  await engine.runRequested();
  expect(calls).toBe(1);
  expect((await store.list('messages', c.id))[0].status).toBe('complete');
});
it('does not call the API when expired or denied notification permission', async () => {
  const { store, c, user } = await setup();
  let now = 1000000;
  await queueRequestedMessage(store, user, 10000, async () => {}, now - 10000);
  const engine = new HeartbeatEngine(
    store,
    async () => {
      throw new Error('must not call');
    },
    {
      enabled: async () => false,
      show: async () => {
        throw new Error('must not deliver');
      },
      cancel: async () => {},
    },
    new Diagnostics(store),
    () => now,
  );
  await engine.runRequested();
  expect((await store.list('intentions', c.id))[0].status).toBe('pending');
  now += 3600001;
  await engine.runRequested();
  expect((await store.list('intentions', c.id))[0].status).toBe('expired');
});
