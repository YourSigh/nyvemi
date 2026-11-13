import { expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/domain/models';
import { ExplorationEngine } from '../src/exploration/engine';
import { ActivityMonitor } from '../src/presence/activity';
import { runBackgroundCycle } from '../src/proactive/heartbeat/driver';
import { Diagnostics } from '../src/storage/diagnostics';
import { migrate, SQLiteStore } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona } from './persona-fixture';

vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));

it('stores a real-source-shaped exploration before intention sync even when proactive notifications are off', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const now = Date.now();
  await store.put('characters', {
    id: 'c',
    persona: { ...demoPersona('c'), likes: ['机器人'], dislikes: [] },
    interests: [],
    state: { energy: 0.7, relationshipCloseness: 0.6, recentFocus: [], curiosityTopics: [] },
    createdAt: now,
  });
  await store.put('settings', {
    ...defaultSettings('c'),
    proactiveEnabled: false,
    lastActiveAt: now,
  });
  const candidates = vi.fn().mockResolvedValue([
    {
      id: 'BV1234567890',
      url: 'https://www.bilibili.com/video/BV1234567890',
      title: '机器人',
      author: '实验室',
      category: '机器人',
      description: '机器人平衡实验',
    },
  ]);
  const report = vi.fn();
  const activity = new ActivityMonitor();
  activity.subscribe(report);
  const read = vi.fn().mockResolvedValue({
    status: 'available',
    bvid: 'BV1234567890',
    part: 1,
    language: 'zh-CN',
    machineGenerated: false,
    cues: [{ start: 0, end: 3, text: '机器人用脚踝调整重心。' }],
  });
  const heartbeat = { run: vi.fn() };
  const syncIntentionWork = vi.fn(async () => {
    const experience = (await store.list('experiences', 'c')).find((e) => e.source === 'bilibili');
    expect(experience?.externalId).toBe('BV1234567890');
    expect(experience?.contentEvidence).toBe('subtitle');
    expect(experience?.content).toContain('机器人用脚踝调整重心');
    expect(experience?.appraisal?.shareImpulse).toBeGreaterThanOrEqual(0.7);
    expect(await store.list('notifications', 'c')).toHaveLength(0);
    expect(await store.list('intentions', 'c')).toContainEqual(
      expect.objectContaining({ type: 'share', status: 'pending', experienceId: experience?.id }),
    );
  });
  const runtime = {
    store,
    exploration: new ExplorationEngine(
      store,
      { id: 'bilibili', candidates },
      {
        available: async () => true,
        read,
      },
    ),
    activity,
    diagnostics: new Diagnostics(store),
    extraction: { drain: vi.fn() },
    syncIntentionWork,
    heartbeat,
  };
  await runBackgroundCycle(runtime, 'periodic_worker');
  await runBackgroundCycle(runtime, 'periodic_worker');
  expect(candidates).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledExactlyOnceWith('BV1234567890', undefined);
  expect(report).toHaveBeenCalledWith('browsing_bilibili', 'c');
  expect(syncIntentionWork).toHaveBeenCalledTimes(2);
  expect(heartbeat.run).toHaveBeenCalledTimes(2);
  expect((await store.list('diagnostics', 'c')).map((d) => d.data)).toContainEqual(
    expect.objectContaining({
      event: 'exploration',
      reason: 'explored',
      trigger: 'periodic_worker',
    }),
  );
  for (let i = 0; i < 201; i++)
    await store.put('diagnostics', {
      id: `tick:${i}`,
      kind: 'heartbeat',
      characterId: '',
      createdAt: now + i + 1,
      data: { event: 'maintenance_finish' },
    });
  await runtime.diagnostics.record('heartbeat', '', { event: 'maintenance_finish' });
  expect(
    (await store.list('diagnostics', 'c')).some((row) => row.data.event === 'exploration'),
  ).toBe(true);
});
