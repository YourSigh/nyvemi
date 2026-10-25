import { expect, it } from 'vitest';
import { conversationContext, interactionState } from '../src/conversation/context';
import { MemoryRecall, recallQuery } from '../src/memory/recall';
import { MemoryRepository } from '../src/memory/repository';
import { Diagnostics } from '../src/storage/diagnostics';
import { migrate, SQLiteStore } from '../src/storage/store';
import type { Message, NotificationRecord } from '../src/domain/models';
import { TestDatabase } from './database';
const user: Message = {
  id: 'u',
  characterId: 'c',
  role: 'user',
  content: '下午要去开机器人的会议',
  createdAt: 1000,
  status: 'complete',
  origin: 'chat',
};
const record: NotificationRecord = {
  id: 'n',
  characterId: 'c',
  messageId: 'm',
  messageIds: ['m', 'm2'],
  title: '桶',
  body: 'x',
  createdAt: 2000,
  status: 'delivered',
};
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  return new SQLiteStore(db);
}
it('counts unanswered proactive bursts, excludes requested messages and resets on new user activity', () => {
  expect(
    interactionState([user], [record, { ...record, id: 'requested:x' }], 61000).unansweredCount,
  ).toBe(1);
  expect(interactionState([{ ...user, createdAt: 3000 }], [record], 61000).unansweredCount).toBe(0);
  expect(
    interactionState([user], [{ ...record, createdAt: 500, deliveredAt: 2000 }], 61000)
      .unansweredCount,
  ).toBe(1);
});
it('injects only real live tasks belonging to the current character and reflects cancellation immediately', async () => {
  const store = await setup();
  await store.put('messages', user);
  const task = {
    id: 'i',
    characterId: 'c',
    type: 'requested' as const,
    topic: '稍后来信',
    reason: '用户要求',
    earliestAt: 2000,
    latestAt: 10000,
    importance: 1,
    status: 'pending' as const,
    createdAt: 1000,
  };
  await store.put('intentions', task);
  await store.put('intentions', {
    ...task,
    id: 'other',
    characterId: 'other',
    topic: '别人的私聊',
  });
  expect(await conversationContext(store, 'c', 1500)).toContain('稍后来信');
  expect(await conversationContext(store, 'c', 1500)).not.toContain('别人的私聊');
  await store.put('intentions', { ...task, status: 'cancelled' });
  expect(await conversationContext(store, 'c', 1500)).not.toContain('稍后来信');
});
it('recalls a short follow-up using recent user topics without leaking another character memory', async () => {
  const store = await setup();
  const repo = new MemoryRepository(store);
  await store.put('messages', user);
  await repo.upsert('c', 'semantic', '用户参与机器人会议，计划讨论机械臂', 0.9, 1000);
  await repo.upsert('other', 'semantic', '机器人会议的私人地址', 1, 1000);
  const memories = await new MemoryRecall(store, new Diagnostics(store)).retrieve(
    'c',
    '后来呢',
    2000,
  );
  expect(memories.map((m) => m.content)).toEqual(['用户参与机器人会议，计划讨论机械臂']);
  expect(recallQuery('换个话题，聊聊晚饭', [user])).toBe('换个话题，聊聊晚饭');
  expect(
    recallQuery('我现在很想详细讨论一下草莓冰淇淋的口味、配料和做法，跟会议没关系', [user]),
  ).not.toContain('下午要去');
});
