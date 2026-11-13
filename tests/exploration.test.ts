import { demoPersona } from './persona-fixture';
import { serializeDatabase } from '../src/storage/serialized';
import { it, expect, vi } from 'vitest';
import {
  BilibiliContentProvider,
  BilibiliSourceError,
  MockContentProvider,
  type ContentItem,
} from '../src/exploration/content';
import { ExplorationEngine, contentInterest } from '../src/exploration/engine';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { defaultSettings, type Character } from '../src/domain/models';
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
  const candidates = vi.fn().mockResolvedValue([cooking, robot]);
  const onFetch = vi.fn();
  const engine = new ExplorationEngine(store, { id: 'mock-bilibili', candidates });
  expect(await engine.run('c', now, { trigger: 'presence_service', onFetch })).toBe('explored');
  expect(candidates).toHaveBeenCalledWith({ topics: ['机器人'] });
  expect(onFetch).toHaveBeenCalledBefore(candidates);
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
  expect(await engine.run('c', now + 4 * 3600000 + 60000)).toBe('cooldown');
  expect(await store.list('experiences', 'c')).toHaveLength(1);
  const logs = await store.list('diagnostics', 'c');
  expect(logs).toHaveLength(2);
  expect(logs[1].data).toMatchObject({
    decision: 'explore',
    trigger: 'presence_service',
    reason: 'explored',
    evidence: 'metadata_only',
  });
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
  const candidates = vi
    .fn()
    .mockRejectedValueOnce(new Error('private failure'))
    .mockResolvedValue([robot]);
  const engine = new ExplorationEngine(store, { id: 'bilibili', candidates });
  expect(await engine.run('c', now)).toBe('provider_unavailable');
  expect(
    await new ExplorationEngine(store, { id: 'bilibili', candidates }).run('c', now + 60000),
  ).toBe('provider_backoff');
  expect(candidates).toHaveBeenCalledOnce();
  expect(await store.list('experiences', 'c')).toHaveLength(0);
  const logs = await store.list('diagnostics', 'c');
  expect(logs).toHaveLength(1);
  expect(JSON.stringify(logs)).not.toContain('private failure');
  expect((await store.get('settings', 'c'))?.lastExplorationAt).toBeUndefined();
  expect(await engine.run('c', now + 30 * 60000)).toBe('explored');
});
it('stores allowlisted provider failure details for background diagnosis', async () => {
  const store = await setup();
  const candidates = vi.fn().mockRejectedValue(new BilibiliSourceError('api', undefined, -412));
  const engine = new ExplorationEngine(store, { id: 'bilibili', candidates });
  await expect(engine.run('c', now, { trigger: 'periodic_worker' })).resolves.toBe(
    'provider_unavailable',
  );
  expect((await store.list('diagnostics', 'c'))[0].data).toMatchObject({
    trigger: 'periodic_worker',
    decision: 'skip',
    reason: 'provider_unavailable',
    failure: 'api',
    apiCode: -412,
  });
});
it('allows silent exploration with proactive delivery disabled and during quiet hours', async () => {
  const store = await setup();
  const candidates = vi.fn().mockResolvedValue([robot]);
  const engine = new ExplorationEngine(store, { id: 'mock-bilibili', candidates });
  await store.put('settings', {
    ...defaultSettings('c'),
    proactiveEnabled: false,
    quietStart: 13,
    quietEnd: 16,
  });
  expect(await engine.run('c', now)).toBe('explored');
  expect(candidates).toHaveBeenCalledOnce();
});
it('rejects disliked or unrelated content', () => {
  expect(contentInterest(character, cooking)).toBe(0);
  expect(
    contentInterest(
      { ...character, persona: { ...character.persona, dislikes: ['机器人'] } },
      robot,
    ),
  ).toBe(0);
});
it('uses precise title and category matches even if the description is long', () => {
  const description = Array.from({ length: 100 }, (_, index) => `unrelated${index}`).join(' ');
  const longDescription = { ...robot, description };
  expect(contentInterest(character, longDescription)).toBe(1);
  expect(
    contentInterest(
      { ...character, persona: { ...character.persona, dislikes: ['机器人'] } },
      longDescription,
    ),
  ).toBe(0);
});
it('skips onboarding but allows a completed character that still uses the cocoon', async () => {
  const store = await setup();
  await store.put('characters', { ...character, egg: true, creationActive: true });
  const candidates = vi.fn().mockResolvedValue([robot]);
  const engine = new ExplorationEngine(store, { id: 'bilibili', candidates });
  expect(await engine.run('c', now)).toBe('creation_active');
  expect(candidates).not.toHaveBeenCalled();
  expect(await store.list('diagnostics', 'c')).toEqual([]);
  await store.put('characters', { ...character, egg: true, creationActive: false });
  expect(await engine.run('c', now)).toBe('explored');
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
it.each([
  { source: 'bilibili', externalId: `${robot.url}/?spm_id_from=333`, url: undefined },
  { source: 'agent-web', externalId: 'old', url: `${robot.url}?share_source=copy_web` },
])('deduplicates previously recorded Bilibili watch URLs (%j)', async (legacy) => {
  const store = await setup();
  await store.put('experiences', {
    id: 'legacy',
    characterId: 'c',
    ...legacy,
    title: robot.title,
    content: robot.description,
    topics: [robot.category],
    createdAt: now - 60000,
  });
  const candidates = vi.fn().mockResolvedValue([robot]);
  const engine = new ExplorationEngine(store, { id: 'bilibili', candidates });
  expect(await engine.run('c', now)).toBe('no_interesting_unseen_content');
  expect((await store.list('experiences', 'c')).map((experience) => experience.id)).toEqual([
    'legacy',
  ]);
});
it('cancels an interrupted fetch without setting a retry delay', async () => {
  const store = await setup();
  const controller = new AbortController();
  const candidates = vi
    .fn()
    .mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('aborted');
    })
    .mockResolvedValue([robot]);
  const engine = new ExplorationEngine(store, { id: 'bilibili', candidates });
  expect(await engine.run('c', now, { signal: controller.signal })).toBe('cancelled_during_fetch');
  expect(await store.list('experiences', 'c')).toEqual([]);
  expect(await engine.run('c', now + 60000)).toBe('explored');
});

it('prefers a relevant candidate with corroborated captions within a bounded shortlist', async () => {
  const store = await setup();
  await store.put('settings', { ...defaultSettings('c'), deepSeekBilibiliSearch: true });
  const alternate = {
    ...robot,
    id: 'BV2222222222',
    title: '机器人实地观察',
    discovery: 'deepseek_search' as const,
  };
  const candidates = vi.fn().mockResolvedValue([robot, alternate]);
  const read = vi
    .fn()
    .mockResolvedValueOnce({ status: 'unavailable', reason: 'no_tracks' })
    .mockResolvedValueOnce({ status: 'available', cues: [{ text: '机器人用脚尖调整重心' }] });
  const engine = new ExplorationEngine(
    store,
    { id: 'bilibili', candidates },
    { read, available: async () => true },
  );
  expect(await engine.run('c', now, { trigger: 'periodic_worker' })).toBe('explored');
  expect(candidates).toHaveBeenCalledWith({ topics: ['机器人'], indexedSearch: true });
  expect(read).toHaveBeenNthCalledWith(1, robot.id, undefined);
  expect(read).toHaveBeenNthCalledWith(2, alternate.id, undefined);
  const [experience] = await store.list('experiences', 'c');
  expect(experience).toMatchObject({ externalId: alternate.id, contentEvidence: 'subtitle' });
  expect(experience.content).toContain('机器人用脚尖调整重心');
  expect((await store.list('diagnostics', 'c'))[0].data).toMatchObject({
    discovery: 'deepseek_search',
    captionStatus: 'read',
    evidence: 'subtitle',
  });
});

it('can choose semantically related indexed material when literal terms do not match', async () => {
  const store = await setup();
  const c = {
    ...character,
    interests: [{ ...character.interests[0], topic: '科技新闻里的小细节' }],
    persona: { ...character.persona, likes: [] },
  };
  await store.put('characters', c);
  await store.put('settings', { ...defaultSettings('c'), deepSeekBilibiliSearch: true });
  const item = {
    ...robot,
    title: '一滴咖啡如何改变工业',
    category: '',
    description: '液滴蒸发的规律可以预测涂料和喷墨的效果。',
    discovery: 'deepseek_search' as const,
  };
  expect(contentInterest(c, item)).toBe(0);
  const choose = vi.fn().mockResolvedValue({ choices: [{ candidate: item.id, interest: 0.95 }] });
  const provider = { id: 'bilibili', candidates: async () => [item] };
  const engine = new ExplorationEngine(store, provider, undefined, choose);
  await expect(engine.run('c', now)).resolves.toBe('explored');
  expect(choose).toHaveBeenCalledExactlyOnceWith(c, '科技新闻里的小细节', [item], undefined);
  const [experience] = await store.list('experiences', 'c');
  expect(experience).toMatchObject({
    externalId: item.id,
    contentEvidence: 'search_snippet',
    appraisal: { selfInterest: 0.95 },
  });
  expect((await store.get('characters', 'c'))!.interests[0].score).toBeGreaterThan(
    c.interests[0].score,
  );
  expect((await store.list('intentions', 'c'))[0].experienceId).toBe(experience.id);
  await expect(engine.run('c', now + 4 * 3600000)).resolves.toBe('no_interesting_unseen_content');
  expect(choose).toHaveBeenCalledTimes(1);
});
