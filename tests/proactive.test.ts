import { it, expect } from 'vitest';
import { HeartbeatEngine, type NotificationGateway } from '../src/proactive/heartbeat/engine';
import { scoreIntention } from '../src/proactive/scoring';
import { isQuietHour } from '../src/proactive/quiet-hours';
import { policyBlock } from '../src/proactive/policies';
import { expireIntentions } from '../src/proactive/intentions';
import {
  defaultSettings,
  demoPersona,
  type Character,
  type Intention,
  type NotificationRecord,
} from '../src/domain/models';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { Diagnostics } from '../src/storage/diagnostics';
import type { LLMProvider } from '../src/providers/provider';
const now = new Date(2026, 9, 22, 19).getTime();
const character: Character = {
  id: 'c',
  persona: demoPersona('c'),
  state: { energy: 0.7, relationshipCloseness: 0.5, recentFocus: [], curiosityTopics: [] },
  interests: [],
  createdAt: now - 86400000,
};
const intention: Intention = {
  id: 'i',
  characterId: 'c',
  type: 'follow_up',
  topic: '下午的 AI代码治理会议',
  earliestAt: now - 4 * 3600000,
  latestAt: now + 3600000,
  importance: 0.9,
  reason: '可以问问结果',
  status: 'pending',
  createdAt: now - 8 * 3600000,
};
const settings = {
  ...defaultSettings('c'),
  proactiveEnabled: true,
  lastActiveAt: now - 6 * 3600000,
};
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('characters', character);
  await store.put('settings', settings);
  return store;
}
it('handles overnight, daytime and disabled quiet hours with exact boundaries', () => {
  const t = (hour: number) => new Date(2026, 9, 22, hour).getTime();
  expect(isQuietHour(t(23), 23, 8)).toBe(true);
  expect(isQuietHour(t(7), 23, 8)).toBe(true);
  expect(isQuietHour(t(8), 23, 8)).toBe(false);
  expect(isQuietHour(t(10), 9, 17)).toBe(true);
  expect(isQuietHour(t(10), 8, 8)).toBe(false);
});
it('enforces daily caps, intervals and recent activity before generation', () => {
  const records: NotificationRecord[] = [0, 1].map((_, n) => ({
    id: String(n),
    characterId: 'c',
    messageId: String(n),
    title: '桶',
    body: 'hi',
    createdAt: now - (n + 1) * 4 * 3600000,
    status: 'delivered',
  }));
  expect(policyBlock(settings, records, now)).toBe('daily_limit');
  expect(policyBlock(settings, [{ ...records[0], createdAt: now - 60000 }], now)).toBe(
    'minimum_interval',
  );
  expect(policyBlock({ ...settings, lastActiveAt: now - 1000 }, [], now)).toBe(
    'recent_active_chat',
  );
});
it('scores context above the threshold and expires stale intentions', async () => {
  expect(scoreIntention(intention, character, now, settings.lastActiveAt).score).toBeGreaterThan(
    0.58,
  );
  const store = await setup();
  await store.put('intentions', { ...intention, latestAt: now });
  expect(await expireIntentions(store, 'c', now)).toBe(1);
  expect((await store.get('intentions', 'i'))?.status).toBe('expired');
});
it('skips most heartbeats without calling a model and explains each skip', async () => {
  const store = await setup();
  let calls = 0;
  const gateway: NotificationGateway = {
    enabled: async () => true,
    show: async () => {},
    cancel: async () => {},
  };
  const engine = new HeartbeatEngine(
    store,
    async () => {
      calls++;
      throw new Error('must not call');
    },
    gateway,
    new Diagnostics(store),
    () => now,
  );
  for (let n = 0; n < 25; n++) await engine.run();
  expect(calls).toBe(0);
  expect(
    (await store.list('diagnostics', 'c')).filter((d) => d.data.reason === 'no_due_intention'),
  ).toHaveLength(25);
});
it('generates once, delivers once and turns notification into a real chat message exactly once', async () => {
  const store = await setup();
  await store.put('intentions', intention);
  let calls = 0;
  const shown: NotificationRecord[] = [];
  const gateway: NotificationGateway = {
    enabled: async () => true,
    show: async (r) => {
      shown.push(r);
    },
    cancel: async () => {},
  };
  const provider: LLMProvider = {
    chat: async () => ({ content: '', usage: {} }),
    streamChat: async () => ({ content: '', usage: {} }),
    structuredOutput: async (_, schema) => {
      calls++;
      return schema.parse({ messages: ['你下午那破会最后咋样了'] });
    },
  };
  const engine = new HeartbeatEngine(
    store,
    async () => provider,
    gateway,
    new Diagnostics(store),
    () => now,
  );
  await engine.run();
  await engine.run();
  expect(calls).toBe(1);
  expect(shown).toHaveLength(1);
  const message = (await store.list('messages', 'c'))[0];
  expect(message.status).toBe('pending');
  expect(await engine.openNotification(shown[0].id)).toBe('c');
  await engine.openNotification(shown[0].id);
  expect(await store.list('messages', 'c')).toHaveLength(1);
  expect((await store.get('messages', message.id))?.status).toBe('complete');
});
it('rechecks activity after model generation and suppresses a now-unwanted interruption', async () => {
  const store = await setup();
  await store.put('intentions', intention);
  let delivered = false;
  const gateway: NotificationGateway = {
    enabled: async () => true,
    show: async () => {
      delivered = true;
    },
    cancel: async () => {},
  };
  const provider: LLMProvider = {
    chat: async () => ({ content: '', usage: {} }),
    streamChat: async () => ({ content: '', usage: {} }),
    structuredOutput: async (_, schema) => {
      await store.put('settings', { ...settings, lastActiveAt: now });
      return schema.parse({ messages: ['开完会了吗'] });
    },
  };
  await new HeartbeatEngine(
    store,
    async () => provider,
    gateway,
    new Diagnostics(store),
    () => now,
  ).run();
  expect(delivered).toBe(false);
  expect(await store.list('messages', 'c')).toHaveLength(0);
  expect((await store.list('diagnostics', 'c'))[0].data.reason).toBe('recent_active_chat');
});
it('recovers persisted outbox delivery without asking the model to generate another message', async () => {
  const store = await setup();
  const n: NotificationRecord = {
    id: 'n',
    characterId: 'c',
    messageId: 'm',
    title: '桶',
    body: '会议怎么样了',
    createdAt: now - 60000,
    status: 'pending',
  };
  await store.put('notifications', n);
  await store.put('messages', {
    id: 'm',
    characterId: 'c',
    role: 'assistant',
    content: n.body,
    origin: 'proactive',
    status: 'pending',
    createdAt: n.createdAt,
  });
  let calls = 0;
  const engine = new HeartbeatEngine(
    store,
    async () => {
      throw new Error('no generation');
    },
    {
      enabled: async () => true,
      show: async () => {
        calls++;
      },
      cancel: async () => {},
    },
    new Diagnostics(store),
    () => now,
  );
  await engine.run();
  expect(calls).toBe(1);
  expect((await store.get('notifications', 'n'))?.status).toBe('delivered');
  expect((await store.list('diagnostics', 'c'))[0].data.reason).toBe('outbox_recovered');
});
