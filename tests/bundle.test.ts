import { defaultPreference } from '../src/theme/model';
import { it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { CharacterBundleService, readBundle, type BundleAssets } from '../src/transfer/bundle';
import { demoPersona, defaultSettings } from '../src/domain/models';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { MemoryRepository } from '../src/memory/repository';
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const assets = new Map<string, Uint8Array>();
  const io: BundleAssets = {
    readAvatar: async (uri) => assets.get(uri)!,
    writeAvatar: async (cid, bytes) => {
      const uri = `file://avatars/${cid}`;
      assets.set(uri, bytes);
      return uri;
    },
    removeAvatar: async (uri) => {
      assets.delete(uri);
    },
  };
  return { db, store, assets, service: new CharacterBundleService(store, io) };
}
it('round-trips the person, memories, conversation, avatar and links into a fresh database without credentials', async () => {
  const a = await setup();
  const b = await setup();
  const avatar = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN0AAAAASUVORK5CYII=',
      'base64',
    ),
  );
  a.assets.set('file://old', avatar);
  await a.store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 0.6, relationshipCloseness: 0.4, recentFocus: ['会议'], curiosityTopics: [] },
    interests: [{ topic: 'Android', score: 0.4, source: 'initial', updatedAt: 1 }],
    avatar: 'file://old',
    createdAt: 1,
  });
  await a.store.put('settings', { ...defaultSettings('c'), proactiveEnabled: true });
  await a.store.put('provider', {
    id: 'provider',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    thinking: false,
  });
  await a.store.put('messages', {
    id: 'u',
    characterId: 'c',
    role: 'user',
    content: '不要套话',
    createdAt: 1,
    origin: 'chat',
    status: 'complete',
  });
  await a.store.put('memories', {
    id: 'm',
    characterId: 'c',
    type: 'open_loop',
    content: '会议',
    importance: 0.8,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    metadata: { apiKey: 'fixture-secret', safe: 'keep' },
  });
  await a.store.put('intentions', {
    id: 'i',
    characterId: 'c',
    type: 'follow_up',
    topic: '会议',
    earliestAt: 2,
    latestAt: 9000000000000,
    importance: 0.8,
    reason: '以后问问',
    status: 'pending',
    openLoopId: 'm',
    createdAt: 1,
  });
  const bytes = await a.service.exportCharacter('c', 'fixture-secret');
  const json = strFromU8(unzipSync(bytes)['manifest.json']);
  expect(json).not.toContain('fixture-secret');
  expect(json).not.toContain('baseUrl');
  expect(json).not.toContain('file://old');
  const imported = await b.service.importCharacter(bytes);
  expect(imported.id).not.toBe('c');
  expect(imported.persona.name).toBe('桶砸');
  expect(imported.state.relationshipCloseness).toBe(0.4);
  expect(b.assets.get(imported.avatar!)).toEqual(avatar);
  const memory = (await b.store.list('memories', imported.id))[0];
  const intention = (await b.store.list('intentions', imported.id))[0];
  expect(intention.openLoopId).toBe(memory.id);
  expect((await b.store.list('messages', imported.id))[0].content).toBe('不要套话');
  expect((await b.store.get('settings', imported.id))?.proactiveEnabled).toBe(false);
  expect(await b.store.list('provider')).toEqual([]);
  await b.service.importCharacter(bytes);
  expect(await b.store.list('characters')).toHaveLength(2);
});
it('rejects path traversal, unknown versions, inconsistent ownership and dangling references before writes', async () => {
  const { store, service } = await setup();
  expect(() => readBundle(zipSync({ '../escape': strToU8('x') }))).toThrow();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 1, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  });
  await store.put('settings', defaultSettings('c'));
  const good = readBundle(await service.exportCharacter('c')).manifest;
  for (const bad of [
    { ...good, version: 999 },
    { ...good, provider: { apiKey: 'bad' } },
    {
      ...good,
      messages: [
        {
          id: 'x',
          characterId: 'other',
          role: 'user',
          content: 'bad',
          createdAt: 1,
          status: 'complete',
          origin: 'chat',
        },
      ],
    },
  ]) {
    await expect(
      service.importCharacter(zipSync({ 'manifest.json': strToU8(JSON.stringify(bad)) })),
    ).rejects.toThrow();
  }
  expect(await store.list('characters')).toHaveLength(1);
});
it('exports safely after open-loop expiration without dangling intent references', async () => {
  const { store, service } = await setup();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 1, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  });
  await store.put('settings', defaultSettings('c'));
  const repo = new MemoryRepository(store);
  const m = await repo.upsert('c', 'open_loop', '会后跟进', 0.8, 1, 10);
  await store.put('intentions', {
    id: 'i',
    characterId: 'c',
    type: 'follow_up',
    topic: m.content,
    earliestAt: 2,
    latestAt: 10,
    importance: 0.8,
    reason: '跟进',
    status: 'pending',
    openLoopId: m.id,
    createdAt: 1,
  });
  await repo.expire('c', 11);
  const bundle = readBundle(await service.exportCharacter('c'));
  expect(bundle.manifest.intentions[0].status).toBe('expired');
  expect(bundle.manifest.intentions[0].openLoopId).toBeUndefined();
});
it('rolls back character data and removes the newly written avatar when import storage fails', async () => {
  const source = await setup();
  const target = await setup();
  source.assets.set(
    'file://avatar',
    Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN0AAAAASUVORK5CYII=',
        'base64',
      ),
    ),
  );
  await source.store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 1, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
    interests: [],
    avatar: 'file://avatar',
    createdAt: 1,
  });
  await source.store.put('settings', defaultSettings('c'));
  await source.store.put('messages', {
    id: 'u',
    characterId: 'c',
    role: 'user',
    content: 'hi',
    createdAt: 1,
    origin: 'chat',
    status: 'complete',
  });
  const bytes = await source.service.exportCharacter('c');
  await target.db.exec(
    "CREATE TRIGGER reject_messages BEFORE INSERT ON entities WHEN NEW.kind='messages' BEGIN SELECT RAISE(ABORT,'disk fixture'); END;",
  );
  await expect(target.service.importCharacter(bytes)).rejects.toThrow();
  expect(await target.store.list('characters')).toEqual([]);
  expect(target.assets.size).toBe(0);
});

it('migrates the chosen appearance while preserving an existing app theme and accepting v1 bundles', async () => {
  const a = await setup(),
    b = await setup();
  await a.store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 0.5, relationshipCloseness: 0.5, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  });
  await a.store.put('settings', defaultSettings('c'));
  const theme = {
    id: 'app' as const,
    version: 1 as const,
    preference: { ...defaultPreference, base: 'blue' as const },
    description: '安静的蓝灰色',
    source: 'model' as const,
    createdAt: 1,
  };
  await a.store.put('themes', theme);
  const bytes = await a.service.exportCharacter('c');
  expect(readBundle(bytes).manifest.version).toBe(2);
  await b.service.importCharacter(bytes);
  expect(await b.store.get('themes', 'app')).toEqual(theme);
  const c = await setup();
  const own = { ...theme, preference: defaultPreference, description: '我的粉白' };
  await c.store.put('themes', own);
  await c.service.importCharacter(bytes);
  expect(await c.store.get('themes', 'app')).toEqual(own);
  const legacy = { ...readBundle(bytes).manifest, version: 1, theme: undefined };
  const d = await setup();
  await d.service.importCharacter(zipSync({ 'manifest.json': strToU8(JSON.stringify(legacy)) }));
  expect(await d.store.list('characters')).toHaveLength(1);
  expect(await d.store.get('themes', 'app')).toBeUndefined();
});
