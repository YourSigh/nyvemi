import { it, expect } from 'vitest';
import { deliveryReport, deliverySummary } from '../src/proactive/delivery-report';
import { defaultSettings } from '../src/domain/models';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
const environment = { notifications: true, online: true, presenceRunning: false };
it('distinguishes no thought, missing registration and native startup failures without exposing private content', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('settings', { ...defaultSettings('c'), proactiveEnabled: true });
  const native = {
    stage: 'runtime_error',
    scheduledAt: 1,
    startedAt: 20,
    finishedAt: 21,
    outcome: 'runtime_error',
    source: 'worker',
    workStates: ['ENQUEUED'],
    attempts: 2,
    apiKey: 'fixture-credential',
  };
  expect(
    deliverySummary(await deliveryReport(store, 'c', async () => native, environment, 100)),
  ).toContain('没有留下');
  await store.put('intentions', {
    id: 'i',
    characterId: 'c',
    type: 'continuation',
    topic: '私人聊天原文',
    reason: '私人关系细节',
    sourceMessageId: 'u',
    earliestAt: 50,
    latestAt: 5000,
    importance: 0.8,
    status: 'pending',
    createdAt: 1,
  });
  await store.put('diagnostics', {
    id: 'd',
    characterId: 'c',
    kind: 'heartbeat',
    createdAt: 30,
    data: {
      intentionId: 'i',
      decision: 'skip',
      reason: 'continuation_generation_or_delivery_error',
      apiKey: 'fixture-credential',
      prompt: '私人聊天原文',
    },
  });
  const report = await deliveryReport(store, 'c', async () => native, environment, 100);
  const text = JSON.stringify(report);
  expect(text).not.toContain('私人');
  expect(text).not.toContain('fixture-credential');
  expect(text).not.toContain('apiKey');
  expect(deliverySummary(report)).toContain('后台运行失败');
  expect(report.tasks[0].reason).toBe('continuation_generation_or_delivery_error');
  expect(
    deliverySummary(
      await deliveryReport(
        store,
        'c',
        async () => ({ ...native, workStates: [] }),
        environment,
        100,
      ),
    ),
  ).toContain('尚未查到');
  expect(
    deliverySummary(
      await deliveryReport(
        store,
        'c',
        async () => native,
        { ...environment, notifications: false },
        100,
      ),
    ),
  ).toContain('通知未开启');
});
