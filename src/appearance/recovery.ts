import type { Storage } from '../storage/store';
// Invoked once when the single Android JS runtime boots. Image work runs only in this
// runtime; it is never scheduled as an independent WorkManager image-generation task.
// Receipts survive, so an interrupted POST remains uncertain instead of being reissued.
export async function recoverVisualWork(store: Storage) {
  await store.release('visual-assets');
  for (const c of await store.list('characters', undefined, 100000))
    await store.release(`visual:${c.id}`);
  for (const r of await store.list('imageRequests', undefined, 100000))
    await store.release(`image-request:${r.id}`);
}
