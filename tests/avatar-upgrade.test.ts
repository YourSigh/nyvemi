import { it, expect } from 'vitest';
import { TestDatabase } from './database';
import { SQLiteStore, migrate } from '../src/storage/store';
import { demoPersona } from '../src/domain/models';
import { upgradeKnownModels } from '../src/avatar/upgrade';
it('upgrades only known sample bytes and preserves custom models, persona and messages', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  for (const cid of ['stock', 'custom'])
    await store.put('characters', {
      id: cid,
      persona: demoPersona(cid),
      createdAt: 1,
      state: { energy: 0.5, relationshipCloseness: 0.3, recentFocus: [], curiosityTopics: [] },
      interests: [],
      meshAvatar: { format: 'p2lrt', version: 1, uri: cid },
    });
  const data = new Map<string, Uint8Array>([
    ['stock', new Uint8Array([1])],
    ['custom', new Uint8Array([2])],
  ]);
  await upgradeKnownModels(
    store,
    {
      read: async (uri) => data.get(uri)!,
      digest: async (b) => String(b[0]),
      write: async (cid, b) => {
        data.set('new-' + cid, b);
        return 'new-' + cid;
      },
      remove: async (uri) => {
        data.delete(uri);
      },
    },
    [{ length: 1, digest: '1' }],
    async () => new Uint8Array([3]),
  );
  expect((await store.get('characters', 'stock'))?.meshAvatar?.uri).toBe('new-stock');
  expect((await store.get('characters', 'stock'))?.persona).toEqual(demoPersona('stock'));
  expect((await store.get('characters', 'custom'))?.meshAvatar?.uri).toBe('custom');
  expect(data.has('stock')).toBe(true);
});
