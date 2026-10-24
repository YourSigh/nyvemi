import { expect, it } from 'vitest';
import { CharacterService, defaultAnswers } from '../src/characters/service';
import { ChatService } from '../src/chat/service';
import { parseChatOutcome } from '../src/chat/outcome';
import { queueRequestedMessage } from '../src/chat/delayed-request';
import { HeartbeatEngine } from '../src/proactive/heartbeat/engine';
import { continuationBlock } from '../src/proactive/continuations';
import { reconcileIntentionWork, executeIntentionWork } from '../src/proactive/requested-delivery';
import { scoreIntention } from '../src/proactive/scoring';
import type { LLMProvider } from '../src/providers/provider';
import { Diagnostics } from '../src/storage/diagnostics';
import { migrate, SQLiteStore } from '../src/storage/store';
import type { NotificationRecord } from '../src/domain/models';
import { TestDatabase } from './database';
const outcome = {
  messages: ['这个点子有点意思', '我还在琢磨你说的那个小细节'],
  continuation: {
    topic: '刚聊的小工具怎样更方便',
    reason: '有一个还想接着聊的具体看法',
    afterMinutes: 3,
  },
};
async function setup(reply = outcome) {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  let generated = 0;
  let decline = false;
  const provider: LLMProvider = {
    chat: async () => ({ content: '', usage: {} }),
    streamChat: async () => ({ content: JSON.stringify(reply), usage: {} }),
    structuredOutput: async (_, schema) => {
      generated++;
      return schema.parse({
        messages: decline ? [] : ['诶，刚才那个我又想到一点', '那个按钮也许放这里会更顺手'],
      });
    },
  };
  const c = await new CharacterService(store, async () => provider).create(
    { ...defaultAnswers, name: '桶砸' },
    true,
  );
  const settings = (await store.get('settings', c.id))!;
  await store.put('settings', { ...settings, quietStart: 0, quietEnd: 0 });
  const scheduled: string[] = [];
  const scheduler = {
    scheduleRequested: async (id: string) => {
      scheduled.push(id);
    },
    cancelRequested: async () => {},
  };
  const chat = new ChatService(
    store,
    async () => provider,
    new Diagnostics(store),
    {
      retrieve: async () => [],
      afterRound: async () => reconcileIntentionWork(store, scheduler),
    },
    async () => {},
  );
  const sent: NotificationRecord[] = [];
  let now = Date.now();
  const engine = new HeartbeatEngine(
    store,
    async () => provider,
    {
      enabled: async () => true,
      show: async (n) => {
        sent.push(n);
      },
      cancel: async () => {},
    },
    new Diagnostics(store),
    () => now,
  );
  return {
    store,
    c,
    chat,
    engine,
    sent,
    scheduled,
    provider,
    calls: () => generated,
    advance: (time: number) => {
      now = time;
    },
    decline: () => {
      decline = true;
    },
  };
}
it('persists a thought during ordinary chat, schedules it, and sends several new bubbles without another user message even with the app recently active', async () => {
  const f = await setup();
  await f.chat.send(f.c.id, '我想把这个小工具做得顺手一点', () => {});
  const task = (await f.store.list('intentions', f.c.id))[0];
  expect(task.type).toBe('continuation');
  expect(f.scheduled).toContain(task.id);
  await f.engine.runContinuations();
  expect(f.calls()).toBe(0);
  f.advance(task.earliestAt);
  const settings = (await f.store.get('settings', f.c.id))!;
  await f.store.put('settings', { ...settings, lastActiveAt: task.earliestAt });
  expect(await executeIntentionWork(f.store, (id) => f.engine.runIntention(id), task.id)).toBe(
    true,
  );
  await f.engine.runContinuations();
  expect(f.calls()).toBe(1);
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0].messageIds).toHaveLength(2);
  const history = await f.chat.history(f.c.id);
  expect(history.filter((m) => m.origin === 'proactive').map((m) => m.content)).toEqual([
    '诶，刚才那个我又想到一点',
    '那个按钮也许放这里会更顺手',
  ]);
  expect(history.every((m) => m.status === 'complete')).toBe(true);
  await f.engine.openNotification(f.sent[0].id);
  expect((await f.store.get('notifications', f.sent[0].id))?.openedAt).toBeDefined();
});
it('drops a stale thought when the user starts a new turn and can choose silence at the second decision', async () => {
  const f = await setup();
  await f.chat.send(f.c.id, '我有一个小工具的点子', () => {});
  const old = (await f.store.list('intentions'))[0];
  await f.store.put('messages', {
    id: 'new-turn',
    characterId: f.c.id,
    role: 'user',
    content: '不聊这个了',
    createdAt: old.createdAt + 1,
    origin: 'chat',
    status: 'complete',
  });
  f.advance(old.earliestAt);
  await f.engine.runContinuations();
  expect(f.calls()).toBe(0);
  expect((await f.store.get('intentions', old.id))?.status).toBe('cancelled');
  const other = await setup();
  await other.chat.send(other.c.id, '我想聊聊这个工具的点子', () => {});
  const task = (await other.store.list('intentions'))[0];
  other.advance(task.earliestAt);
  other.decline();
  await other.engine.runContinuations();
  await other.engine.runContinuations();
  expect(other.calls()).toBe(1);
  expect(other.sent).toHaveLength(0);
});
it('respects disabled initiative, quiet hours and separate continuation caps', async () => {
  const f = await setup();
  const settings = (await f.store.get('settings', f.c.id))!;
  await f.store.put('settings', { ...settings, proactiveEnabled: false });
  await f.chat.send(f.c.id, '我有一个点子想聊聊', () => {});
  expect(await f.store.list('intentions')).toHaveLength(0);
  await f.store.put('settings', {
    ...settings,
    proactiveEnabled: true,
    quietStart: 0,
    quietEnd: 0,
  });
  await f.chat.send(f.c.id, '接着聊刚才的点子', () => {});
  const task = (await f.store.list('intentions'))[0];
  const now = task.earliestAt;
  const hour = new Date(now).getHours();
  expect(
    await continuationBlock(
      f.store,
      task,
      { ...settings, quietStart: hour, quietEnd: (hour + 1) % 24 },
      [],
      now,
    ),
  ).toBe('quiet_hours');
  const records: NotificationRecord[] = [1, 2].map((n) => ({
    id: String(n),
    characterId: f.c.id,
    messageId: String(n),
    title: '桶',
    body: 'hi',
    createdAt: now - n * 60000,
    status: 'delivered',
    deliveryKind: 'continuation',
  }));
  expect(
    await continuationBlock(
      f.store,
      task,
      { ...settings, quietStart: 0, quietEnd: 0 },
      records,
      now,
    ),
  ).toBe('continuation_hour_limit');
});
it('allows a normal new relationship follow-up within its short window rather than scoring it below threshold until expiry', async () => {
  const f = await setup();
  const now = Date.now();
  const score = scoreIntention(
    {
      id: 'follow',
      characterId: f.c.id,
      type: 'follow_up',
      topic: '会议结果',
      reason: '可以问问',
      earliestAt: now - 15 * 60000,
      latestAt: now + 15 * 60000,
      importance: 0.72,
      status: 'pending',
      createdAt: now - 45 * 60000,
    },
    f.c,
    now,
    now - 45 * 60000,
  );
  expect(score.score).toBeGreaterThanOrEqual(score.threshold);
});
it('uses a validated semantic scheduling action for varied word order and never confirms before registration', async () => {
  const f = await setup();
  const provider: LLMProvider = {
    ...f.provider,
    streamChat: async () => ({
      content: JSON.stringify({ messages: [], schedule: { afterSeconds: 60 } }),
      usage: {},
    }),
  };
  let registered = false;
  const service = new ChatService(f.store, async () => provider, new Diagnostics(f.store), {
    retrieve: async () => [],
    afterRound: async () => {},
    scheduleRequested: (user, ms) =>
      queueRequestedMessage(f.store, user, ms, async () => {
        registered = true;
      }),
  });
  await service.send(f.c.id, '我们来试试吧，你等会儿给我发条消息，等一分钟就好', () => {});
  expect(registered).toBe(true);
  expect((await service.history(f.c.id)).at(-1)?.content).toContain('记下了');
  expect(() => parseChatOutcome('{"messages":[],"schedule":{"afterSeconds":-10}}')).toThrow();
});
