import { serializeDatabase } from '../src/storage/serialized';
import { it, expect, vi } from 'vitest';
import {
  BilibiliContentProvider,
  MockContentProvider,
  type ContentItem,
} from '../src/exploration/content';
import { ExplorationEngine, contentInterest } from '../src/exploration/engine';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona, defaultSettings, type Character } from '../src/domain/models';
import { HeartbeatEngine } from '../src/proactive/heartbeat/engine';
import { Diagnostics } from '../src/storage/diagnostics';
const now = new Date(2026, 9, 28, 14).getTime();
const robot: ContentItem = {
  id: 'BV1234567890',
  title: '机器人',
  category: '机器人',
  description: '机器人平衡实验',
  author: '测试作者',
  url: 'https://www.bilibili.com/video/BV1234567890',
};
const cooking: ContentItem = {
  ...robot,
  id: 'BV0987654321',
  title: '做饭',
  category: '美食',
  description: '厨房做饭',
};
const character: Character = {
  id: 'c',
  persona: { ...demoPersona('c'), likes: ['机器人'], dislikes: [] },
  interests: [{ topic: '机器人', score: 0.8, source: 'initial', updatedAt: now - 86400000 }],
  state: { energy: 0.7, relationshipCloseness: 0.6, recentFocus: [], curiosityTopics: [] },
  createdAt: now,
};
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(serializeDatabase(db));
  await store.put('characters', character);
  await store.put('settings', {
    ...defaultSettings('c'),
    proactiveEnabled: true,
    lastActiveAt: now - 86400000,
  });
  return store;
}
it('selects by own interests, persists browse history, experience, interest growth, memory and delayed share', async () => {
  const store = await setup();
  await store.put('memories', {
    id: 'user',
    characterId: 'c',
    type: 'semantic',
    content: '用户喜欢做饭',
    importance: 1,
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
  });
  const engine = new ExplorationEngine(store, new MockContentProvider([cooking, robot]));
  expect(await engine.run('c', now)).toBe('explored');
  const experiences = await store.list('experiences', 'c');
  expect(experiences).toHaveLength(1);
  expect(experiences[0].externalId).toBe(robot.id);
  expect(experiences[0].content).toContain('没有播放视频');
  expect(experiences[0].appraisal!.shareImpulse).toBeGreaterThanOrEqual(0.7);
  expect((await store.get('characters', 'c'))!.interests[0].score).toBeGreaterThan(0.8);
  expect((await store.list('memories', 'c')).some((m) => m.type === 'experience')).toBe(true);
  const intents = await store.list('intentions', 'c');
  expect(intents).toHaveLength(1);
  expect(intents[0].experienceId).toBe(experiences[0].id);
  expect(await engine.run('c', now + 60000)).toBe('cooldown');
  expect(await engine.run('c', now + 4 * 3600000)).toBe('no_interesting_unseen_content');
  expect(await store.list('experiences', 'c')).toHaveLength(1);
});
it('feeds the saved experience to proactive generation and delivers one natural message', async () => {
  const store = await setup();
  await new ExplorationEngine(store, new MockContentProvider([robot])).run('c', now);
  const structuredOutput = vi
    .fn()
    .mockResolvedValue({ messages: ['刷到个机器人平衡实验，光看简介就想知道它怎么稳住的'] });
  const show = vi.fn();
  const provider = {
    structuredOutput,
  } as unknown as import('../src/providers/provider').LLMProvider;
  const heartbeat = new HeartbeatEngine(
    store,
    async () => provider,
    { enabled: async () => true, show, cancel: async () => {} },
    new Diagnostics(store),
    () => now + 2 * 3600000,
  );
  await heartbeat.run();
  expect(structuredOutput).toHaveBeenCalled();
  expect(show).toHaveBeenCalledOnce();
  expect(JSON.stringify(structuredOutput.mock.calls[0][0])).toContain('没有播放视频');
  expect((await store.list('intentions', 'c'))[0].status).toBe('completed');
  await heartbeat.run();
  expect(show).toHaveBeenCalledOnce();
});
it('records failure and backs off without inventing a mock experience', async () => {
  const store = await setup();
  const candidates = vi.fn().mockRejectedValue(new Error('private failure'));
  const engine = new ExplorationEngine(store, { id: 'bilibili', candidates });
  expect(await engine.run('c', now)).toBe('provider_unavailable');
  expect(await engine.run('c', now + 60000)).toBe('cooldown');
  expect(candidates).toHaveBeenCalledOnce();
  expect(await store.list('experiences', 'c')).toHaveLength(0);
  expect(JSON.stringify(await store.list('diagnostics', 'c'))).not.toContain('private failure');
});
it('respects disabled/quiet settings and rejects disliked or unrelated content', async () => {
  const store = await setup();
  const candidates = vi.fn().mockResolvedValue([robot]);
  const engine = new ExplorationEngine(store, { id: 'mock-bilibili', candidates });
  await store.put('settings', { ...defaultSettings('c'), proactiveEnabled: false });
  expect(await engine.run('c', now)).toBe('disabled');
  await store.put('settings', {
    ...defaultSettings('c'),
    proactiveEnabled: true,
    quietStart: 13,
    quietEnd: 16,
  });
  expect(await engine.run('c', now)).toBe('quiet_hours');
  expect(candidates).not.toHaveBeenCalled();
  expect(contentInterest(character, cooking)).toBe(0);
  expect(
    contentInterest(
      { ...character, persona: { ...character.persona, dislikes: ['机器人'] } },
      robot,
    ),
  ).toBe(0);
});
it('parses guest responses without cookies and rejects invalid IDs, API errors and oversized bodies', async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        code: 0,
        data: {
          list: [
            { bvid: robot.id, title: '<b>机器人</b>', desc: '介绍', tname: '科技' },
            { bvid: '../bad', title: 'bad' },
          ],
        },
      }),
    ),
  );
  expect(await new BilibiliContentProvider(request).candidates()).toHaveLength(1);
  expect(request.mock.calls[0][1].credentials).toBe('omit');
  for (const body of [{ code: -412 }, { code: 0, data: { list: [] } }]) {
    const p = new BilibiliContentProvider(async () => new Response(JSON.stringify(body)));
    if (body.code) await expect(p.candidates()).rejects.toThrow();
    else expect(await p.candidates()).toEqual([]);
  }
  await expect(
    new BilibiliContentProvider(async () => new Response('x'.repeat(1048577))).candidates(),
  ).rejects.toThrow();
});
it('honors exploration opt-out and cancellation during network fetch', async () => {
  const store = await setup();
  const candidates = vi.fn().mockResolvedValue([robot]);
  await store.put('settings', {
    ...(await store.get('settings', 'c'))!,
    explorationEnabled: false,
  });
  expect(await new ExplorationEngine(store, { id: 'bilibili', candidates }).run('c', now)).toBe(
    'disabled',
  );
  expect(candidates).not.toHaveBeenCalled();
  await store.put('settings', { ...(await store.get('settings', 'c'))!, explorationEnabled: true });
  candidates.mockImplementation(async () => {
    await store.put('settings', {
      ...(await store.get('settings', 'c'))!,
      explorationEnabled: false,
    });
    return [robot];
  });
  expect(await new ExplorationEngine(store, { id: 'bilibili', candidates }).run('c', now)).toBe(
    'cancelled_during_fetch',
  );
  expect(await store.list('experiences', 'c')).toHaveLength(0);
});
it('serializes concurrent exploration so one candidate request creates one history entry', async () => {
  const store = await setup();
  const candidates = vi.fn().mockResolvedValue([robot]);
  const engine = new ExplorationEngine(store, { id: 'mock-bilibili', candidates });
  await Promise.all([engine.run('c', now), engine.run('c', now)]);
  expect(candidates).toHaveBeenCalledOnce();
  expect(await store.list('experiences', 'c')).toHaveLength(1);
});
