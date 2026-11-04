import { expect, it } from 'vitest';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { mockRig } from '../src/appearance/mock';
import { restoreRigMetadata } from '../src/appearance/rig-metadata';
it('recovers an explicit background label from its exact paid receipt without guessing other details', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const receipt = 'a'.repeat(64);
  await store.put('imageRequests', {
    id: receipt,
    createdAt: 1,
    status: 'done',
    response: { data: [{ name: 'base' }, { name: 'base background' }, { name: 'ribbon' }] },
  });
  const rig = mockRig('x');
  rig.source = 'seedream';
  const detail = { ...rig.layers[0], role: 'detail' as const };
  rig.layers.push(
    { ...detail, asset: { uri: `file:///images/${receipt}-1.png`, width: 100, height: 100 } },
    { ...detail, asset: { uri: `file:///images/${receipt}-2.png`, width: 100, height: 100 } },
    { ...detail, asset: { uri: 'file:///unknown.png', width: 100, height: 100 } },
  );
  const next = await restoreRigMetadata(store, rig);
  expect(next.layers.slice(-3).map((l) => l.role)).toEqual(['background', 'detail', 'detail']);
  expect(rig.layers.at(-3)?.role).toBe('detail');
  expect(await restoreRigMetadata(store, next)).toBe(next);
  const mock = { ...rig, source: 'mock' as const };
  expect(await restoreRigMetadata(store, mock)).toBe(mock);
});
