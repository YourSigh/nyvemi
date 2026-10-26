import { it, expect } from 'vitest';
import { TestDatabase } from './database';
import { SQLiteStore, migrate } from '../src/storage/store';
import { pruneVisualAssets } from '../src/appearance/cleanup';
import { mockRig } from '../src/appearance/mock';
import { demoPersona } from '../src/domain/models';
it('clears unused images and caches while retaining another character and uncertain receipts', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const rig = mockRig('c');
  rig.layers = rig.layers.map((l) => ({
    ...l,
    asset: { uri: 'file://keep', width: 1, height: 1 },
  }));
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 0.5, relationshipCloseness: 0.1, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
    rig,
  });
  await store.put('imageRequests', {
    id: 'old',
    createdAt: 1,
    status: 'done',
    result: { uri: 'file://old', width: 1, height: 1 },
  });
  await store.put('imageRequests', { id: 'uncertain', createdAt: 1, status: 'started' });
  const removed: string[] = [];
  await pruneVisualAssets(store, {
    list: async () => ['file://keep', 'file://old'],
    remove: async (uri) => {
      removed.push(uri);
    },
  });
  expect(removed).toEqual(['file://old']);
  expect(await store.get('imageRequests', 'old')).toBeUndefined();
  expect(await store.get('imageRequests', 'uncertain')).toBeDefined();
});
