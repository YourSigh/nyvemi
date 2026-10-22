import { it, expect } from 'vitest';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { MemoryRepository } from '../src/memory/repository';
import { KeywordMemoryRetriever } from '../src/memory/retrieval';
import { MemoryExtractionService, type Extraction } from '../src/memory/extraction';
import { Diagnostics } from '../src/storage/diagnostics';
import { defaultSettings } from '../src/domain/models';
import { demoPersona, type LLMResult } from './test-fixtures';
import type { LLMProvider } from '../src/providers/provider';
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  return { store, repo: new MemoryRepository(store) };
}
const empty: Extraction = {
  memories: [],
  openLoops: [],
  relationshipUpdates: [],
  personaFeedback: [],
  completedOpenLoopIds: [],
};
const unavailable: LLMProvider = {
  chat: async (): Promise<LLMResult> => {
    throw new Error('offline');
  },
  streamChat: async () => {
    throw new Error('offline');
  },
  structuredOutput: async () => {
    throw new Error('offline');
  },
};
it('supports CRUD, merges near duplicates, tracks access and removes expired memories', async () => {
  const { store, repo } = await setup();
  const m = await repo.upsert('c', 'semantic', '用户正在开发 Android 数字人应用', 0.6, 1000, 5000);
  const merged = await repo.upsert(
    'c',
    'semantic',
    '用户正在开发 Android 数字人应用。',
    0.8,
    2000,
    6000,
  );
  expect(merged.id).toBe(m.id);
  expect(merged.importance).toBe(0.8);
  await repo.touch([merged], 2100);
  expect((await repo.get(m.id))?.accessCount).toBe(1);
  expect(await repo.list('other', 2200)).toEqual([]);
  expect(await repo.list('c', 6000)).toEqual([]);
  expect(await repo.expire('c', 6000)).toBe(1);
  expect(await store.get('memories', m.id)).toBeUndefined();
  const keep = await repo.upsert('c', 'semantic', '常驻偏好', 0.8, 7000);
  await repo.remove(keep.id);
  expect(await repo.get(keep.id)).toBeUndefined();
});
it('ranks relevant Chinese memories above unrelated recent facts and excludes expired data', async () => {
  const { repo } = await setup();
  const relevant = await repo.upsert(
    'c',
    'episodic',
    '讨论 AI代码治理会议和 Android 自动化',
    0.8,
    1000,
  );
  await repo.upsert('c', 'semantic', '最喜欢草莓冰淇淋', 1, 2000);
  await repo.upsert('c', 'episodic', 'AI代码治理会议', 1, 2000, 2500);
  const relationship = await repo.upsert(
    'c',
    'relationship',
    '用户讨厌模板式共情和结尾问要不要继续',
    0.9,
    1000,
  );
  const result = new KeywordMemoryRetriever().rank(
    'AI代码治理会议',
    await repo.list('c', 3000),
    3000,
  );
  expect(result[0].memory.id).toBe(relevant.id);
  expect(result.some((r) => r.memory.id === relationship.id)).toBe(true);
  expect(result).toHaveLength(2);
});
it('extracts preferences, persists open loops and completes their intentions together', async () => {
  const { store, repo } = await setup();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 0.7, relationshipCloseness: 0.1, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  });
  await store.put('settings', { ...defaultSettings('c'), proactiveEnabled: true });
  const extraction = new MemoryExtractionService(
    store,
    async () => unavailable,
    new Diagnostics(store),
  );
  const data: Extraction = {
    ...empty,
    relationshipUpdates: [
      { content: '用户不喜欢每轮最后问要不要继续', importance: 0.9, expiresInDays: null },
    ],
    personaFeedback: ['不要在每句话结尾问要不要继续'],
    openLoops: [
      {
        topic: '下午的 AI代码治理会议',
        importance: 0.72,
        reason: '值得之后问问结果',
        earliestInMinutes: 180,
        latestInMinutes: 720,
      },
    ],
  };
  await extraction.apply('c', data, 1000, 'round1');
  await extraction.apply('c', data, 2000, 'round1');
  expect((await repo.list('c', 3000)).filter((m) => m.type === 'relationship')).toHaveLength(1);
  const loops = (await repo.list('c', 3000)).filter((m) => m.type === 'open_loop');
  expect(loops).toHaveLength(1);
  expect(await store.list('intentions', 'c')).toHaveLength(1);
  expect((await store.get('characters', 'c'))?.persona.responsePreferences).toContain(
    data.personaFeedback[0],
  );
  expect((await store.get('characters', 'c'))?.state.recentFocus).toContain(
    data.openLoops[0].topic,
  );
  expect((await store.get('settings', 'c'))?.proactiveEnabled).toBe(true);
  await extraction.apply(
    'c',
    { ...empty, completedOpenLoopIds: [loops[0].id], proactivityPreference: 'pause' },
    4000,
    'round2',
  );
  expect((await store.get('settings', 'c'))?.proactiveEnabled).toBe(false);
  expect((await store.list('intentions', 'c'))[0].status).toBe('completed');
  expect((await repo.list('c', 5000)).some((m) => m.type === 'open_loop')).toBe(false);
});
it('keeps failed extraction durable with backoff instead of losing the conversation', async () => {
  const { store } = await setup();
  const service = new MemoryExtractionService(
    store,
    async () => unavailable,
    new Diagnostics(store),
  );
  const user = {
    id: 'u',
    characterId: 'c',
    role: 'user' as const,
    content: '我最烦模板式回答',
    createdAt: Date.now(),
    origin: 'chat' as const,
    status: 'complete' as const,
  };
  await store.put('messages', user);
  await service.enqueue('c', user, []);
  const now = Date.now();
  await service.drain(now);
  const job = await store.get('extractions', 'u');
  expect(job?.status).toBe('pending');
  expect(job?.attempts).toBe(1);
  expect(job!.nextAttemptAt).toBeGreaterThan(now);
  expect((await store.get('messages', 'u'))?.content).toBe(user.content);
});
it('cancels follow-ups when the user forgets their source loop', async () => {
  const { store, repo } = await setup();
  const m = await repo.upsert('c', 'open_loop', '下午的会', 0.8, 1000, 10000);
  await store.put('intentions', {
    id: 'i',
    characterId: 'c',
    type: 'follow_up',
    topic: m.content,
    earliestAt: 2000,
    latestAt: 10000,
    importance: 0.8,
    reason: 'follow up',
    status: 'pending',
    openLoopId: m.id,
    createdAt: 1000,
  });
  await repo.remove(m.id);
  expect((await store.get('intentions', 'i'))?.status).toBe('completed');
});
