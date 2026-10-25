import { expect, it } from 'vitest';
import { CharacterService, defaultAnswers } from '../src/characters/service';
import { ChatService } from '../src/chat/service';
import { Diagnostics } from '../src/storage/diagnostics';
import { SQLiteStore, migrate } from '../src/storage/store';
import { HeartbeatEngine } from '../src/proactive/heartbeat/engine';
import { reconcileIntentionWork, executeIntentionWork } from '../src/proactive/requested-delivery';
import {
  autonomousBlock,
  asksForSpace,
  reconnectDelay,
  recoverReconnects,
} from '../src/proactive/reconnect';
import { nextOutsideQuietHours } from '../src/proactive/quiet-hours';
import { defaultSettings, type NotificationRecord } from '../src/domain/models';
import type { LLMProvider } from '../src/providers/provider';
import { policyBlock } from '../src/proactive/policies';
import { TestDatabase } from './database';
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  let now = Date.now();
  let calls = 0;
  let mode: 'send' | 'decline' | 'error' | 'new_user' | 'nested' = 'send';
  const diagnostics = new Diagnostics(store);
  const sent: NotificationRecord[] = [];
  const scheduled: string[] = [];
  const provider: LLMProvider = {
    chat: async () => {
      throw new Error('unused');
    },
    streamChat: async () => ({
      content: '{"messages":["又是加班啊","那帮人是真能折腾"],"continuation":null}',
      usage: {},
    }),
    structuredOutput: async (turns, schema) => {
      calls++;
      expect(turns[0].content).toContain('不是用户发来新消息');
      expect(turns[0].content).toContain('actualPendingTasks');
      if (mode === 'nested') {
        mode = 'send';
        const task = (await store.list('intentions', 'c')).find((i) => i.type === 'reconnect')!;
        await store.put('intentions', {
          ...task,
          id: 'nested-intent',
          type: 'follow_up',
          importance: 1,
          earliestAt: now,
        });
        await engine.run('nested-intent');
      }
      if (mode === 'error') throw new Error('offline');
      if (mode === 'new_user')
        await store.put('messages', {
          id: 'new',
          characterId: 'c',
          role: 'user',
          origin: 'chat',
          status: 'complete',
          content: '换个话题啦',
          createdAt: now + 1,
        });
      return schema.parse({
        messages: mode === 'decline' ? [] : ['诶，刚才说加班那个', '我又想到个很离谱的地方'],
      });
    },
  };
  await new CharacterService(store, async () => provider).create(
    { ...defaultAnswers, name: '桶砸' },
    true,
    'c',
  );
  await store.put('settings', {
    ...defaultSettings('c'),
    proactiveEnabled: true,
    quietStart: 0,
    quietEnd: 0,
  });
  const scheduler = {
    scheduleRequested: async (id: string) => {
      scheduled.push(id);
    },
    cancelRequested: async () => {},
  };
  const chat = new ChatService(
    store,
    async () => provider,
    diagnostics,
    {
      retrieve: async () => [],
      afterRound: async () => {
        await reconcileIntentionWork(store, scheduler);
      },
    },
    async () => {},
  );
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
    diagnostics,
    () => now,
  );
  return {
    store,
    chat,
    engine,
    sent,
    scheduled,
    scheduler,
    advance: (t: number) => {
      now = t;
    },
    mode: (value: typeof mode) => {
      mode = value;
    },
    calls: () => calls,
  };
}
it('ordinary chat with no model continuation still schedules and sends a contextual multi-bubble reconnect after silence', async () => {
  const f = await setup();
  await f.chat.send('c', '今天上班烦死了，又被拉着加班', () => {});
  const task = (await f.store.list('intentions', 'c')).find((i) => i.type === 'reconnect')!;
  expect(task).toBeDefined();
  expect(f.scheduled).toContain(task.id);
  for (let n = 0; n < 20; n++) await f.engine.runReconnects();
  expect(f.calls()).toBe(0);
  f.advance(task.earliestAt);
  const s = (await f.store.get('settings', 'c'))!;
  await f.store.put('settings', { ...s, lastActiveAt: task.earliestAt });
  expect(await executeIntentionWork(f.store, (id) => f.engine.runIntention(id), task.id)).toBe(
    true,
  );
  await f.engine.runReconnects();
  expect(f.calls()).toBe(1);
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0].messageIds).toHaveLength(2);
  const messages = await f.chat.history('c');
  expect(messages.filter((m) => m.origin === 'proactive').map((m) => m.content)).toEqual([
    '诶，刚才说加班那个',
    '我又想到个很离谱的地方',
  ]);
  expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
});
it('recovers a persisted task without changing its deadline or reviving a declined evaluation', async () => {
  const f = await setup();
  await f.chat.send('c', '今天上班烦死了又在加班', () => {});
  const task = (await f.store.list('intentions', 'c'))[0];
  await recoverReconnects(f.store, task.createdAt + 60000);
  expect(await f.store.list('intentions', 'c')).toEqual([task]);
  f.mode('decline');
  f.advance(task.earliestAt);
  await f.engine.runReconnects();
  for (let n = 0; n < 10; n++) {
    await recoverReconnects(f.store, task.earliestAt + n * 60000);
    await f.engine.runReconnects();
  }
  expect(f.calls()).toBe(1);
  expect(f.sent).toHaveLength(0);
  expect((await f.store.get('intentions', task.id))?.status).toBe('completed');
});
it('cancels the old evaluation on a new user turn and rechecks after generation', async () => {
  const f = await setup();
  await f.chat.send('c', '今天上班烦死了又在加班', () => {});
  const old = (await f.store.list('intentions', 'c'))[0];
  await f.chat.send('c', '换个话题聊聊明天做饭吧', () => {});
  expect((await f.store.get('intentions', old.id))?.status).toBe('cancelled');
  const current = (await f.store.list('intentions', 'c')).find((t) => t.status === 'pending')!;
  f.advance(current.earliestAt);
  f.mode('new_user');
  await f.engine.runReconnects();
  expect(f.sent).toHaveLength(0);
  expect((await f.store.get('intentions', current.id))?.status).toBe('cancelled');
});
it('caps unanswered bursts, respects requests for space and excludes explicit reminders from the count', async () => {
  const f = await setup();
  await f.chat.send('c', '今天上班烦死了又在加班', () => {});
  const task = (await f.store.list('intentions', 'c'))[0];
  const records: NotificationRecord[] = [1, 2].map((n) => ({
    id: String(n),
    characterId: 'c',
    messageId: String(n),
    body: '想法',
    title: '桶',
    status: 'delivered',
    createdAt: task.createdAt + n,
  }));
  expect(await autonomousBlock(f.store, 'c', records, task.earliestAt)).toBe('awaiting_user_reply');
  expect(
    await autonomousBlock(
      f.store,
      'c',
      records.map((n) => ({ ...n, deliveryKind: 'requested' })),
      task.earliestAt,
    ),
  ).toBeUndefined();
  await f.chat.send('c', '我先去睡觉了，晚安', () => {});
  expect(
    (await f.store.list('intentions', 'c')).some(
      (t) => t.type === 'reconnect' && t.status === 'pending',
    ),
  ).toBe(false);
  expect(asksForSpace('我不想睡觉，继续聊')).toBe(false);
  expect(asksForSpace('他说晚安之后又消失了，真让人难过')).toBe(false);
  expect(asksForSpace('他说“别联系我”，我很难过')).toBe(false);
});
it('bounds failed generations and local ticks never cause repeated paid calls before retry time', async () => {
  const f = await setup();
  await f.chat.send('c', '今天上班烦死了又在加班', () => {});
  f.mode('error');
  const task = (await f.store.list('intentions', 'c'))[0];
  f.advance(task.earliestAt);
  for (let n = 0; n < 3; n++) {
    await f.engine.runReconnects();
    for (let j = 0; j < 10; j++) await f.engine.runReconnects();
    const fresh = (await f.store.get('intentions', task.id))!;
    f.advance(fresh.earliestAt);
  }
  expect(f.calls()).toBe(3);
  expect((await f.store.get('intentions', task.id))?.status).toBe('cancelled');
});
it('defers to a specific due intention and respects opt-out, quiet hours and the independent daily cap', async () => {
  const f = await setup();
  await f.chat.send('c', '今天上班烦死了又在加班', () => {});
  const task = (await f.store.list('intentions', 'c'))[0];
  f.advance(task.earliestAt);
  await f.store.put('intentions', {
    ...task,
    id: 'specific',
    type: 'follow_up',
    importance: 0.8,
    topic: '会议结束',
    earliestAt: task.earliestAt,
  });
  await f.engine.runReconnects();
  expect(f.calls()).toBe(0);
  const logs = await f.store.list('diagnostics', 'c');
  expect(logs.some((l) => l.data.reason === 'reconnect_specific_intention')).toBe(true);
  const setting = (await f.store.get('settings', 'c'))!;
  expect(policyBlock({ ...setting, lastActiveAt: 0, dailyLimit: 0 }, [], task.earliestAt)).toBe(
    'daily_limit',
  );
  await f.store.put('settings', { ...setting, proactiveEnabled: false });
  await reconcileIntentionWork(f.store, f.scheduler, task.earliestAt);
  expect(f.calls()).toBe(0);
  const night = new Date(2026, 9, 25, 23, 50).getTime();
  const morning = nextOutsideQuietHours(night, 23, 8);
  expect(new Date(morning).getDate()).toBe(26);
  expect(new Date(morning).getHours()).toBe(8);
  expect(nextOutsideQuietHours(night, 0, 0)).toBe(night);
  expect(reconnectDelay('stable')).toBe(reconnectDelay('stable'));
  expect(reconnectDelay('stable')).toBeGreaterThanOrEqual(12 * 60000);
  expect(reconnectDelay('stable')).toBeLessThanOrEqual(25 * 60000);
});

it('serializes ordinary and silence-triggered outbound generation across the shared delivery lease', async () => {
  const f = await setup();
  await f.chat.send('c', '今天加班真想找个办法解决', () => {});
  const task = (await f.store.list('intentions', 'c'))[0];
  f.advance(task.earliestAt);
  f.mode('nested');
  await f.engine.runReconnects();
  expect(f.calls()).toBe(1);
});
