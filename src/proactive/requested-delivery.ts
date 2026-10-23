import type { Storage } from '../storage/store';

export interface RequestedWorkScheduler {
  scheduleRequested(id: string, characterId: string, dueAt: number): Promise<void>;
  cancelRequested(id: string): Promise<void>;
}
/** Upgrade/restart recovery. KEEP work policy preserves existing deadlines and retry backoff. */
export async function reconcileRequestedWork(
  store: Storage,
  scheduler: RequestedWorkScheduler,
  now = Date.now(),
): Promise<void> {
  for (const task of await store.list('intentions', undefined, 10000)) {
    if (task.type !== 'requested') continue;
    if (task.status === 'pending' && task.latestAt > now) {
      await scheduler.scheduleRequested(task.id, task.characterId, task.earliestAt);
    } else {
      await scheduler.cancelRequested(task.id);
      if (task.status === 'pending') await store.put('intentions', { ...task, status: 'expired' });
    }
  }
}

/** A finished headless callback is not proof of delivery: the durable task is authoritative. */
export async function executeRequestedWork(
  store: Storage,
  run: (id: string) => Promise<void>,
  id: string,
): Promise<boolean> {
  const task = await store.get('intentions', id);
  if (!task || task.type !== 'requested' || task.status !== 'pending') return true;
  await run(id);
  const fresh = await store.get('intentions', id);
  return !fresh || fresh.status !== 'pending';
}

export async function cancelRequestedWork(
  store: Storage,
  scheduler: RequestedWorkScheduler,
  intentionId: string,
): Promise<void> {
  const task = await store.get('intentions', intentionId);
  if (!task || task.type !== 'requested' || task.status !== 'pending') return;
  // Persist first. Even a live native callback must re-check this before generating/delivering.
  await store.put('intentions', { ...task, status: 'cancelled' });
  await scheduler.cancelRequested(task.id);
}
