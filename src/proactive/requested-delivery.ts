import { recoverReconnects } from './reconnect';
import type { Storage } from '../storage/store';

export interface RequestedWorkScheduler {
  scheduleRequested(id: string, characterId: string, dueAt: number): Promise<void>;
  cancelRequested(id: string): Promise<void>;
}
/** Upgrade/restart recovery. KEEP work policy preserves existing deadlines and retry backoff. */
export async function reconcileIntentionWork(
  store: Storage,
  scheduler: RequestedWorkScheduler,
  now = Date.now(),
): Promise<void> {
  await recoverReconnects(store, now);
  for (const task of await store.list('intentions', undefined, 10000)) {
    // Old terminal tasks cannot deliver again; avoid re-cancelling years of history every chat.
    if (task.status !== 'pending' && now - task.createdAt > 86400000) continue;
    const settings = await store.get('settings', task.characterId);
    if (task.type !== 'requested' && !settings?.proactiveEnabled) {
      await scheduler.cancelRequested(task.id);
      continue;
    }
    if (task.status === 'pending' && task.latestAt > now) {
      await scheduler.scheduleRequested(task.id, task.characterId, task.earliestAt);
    } else {
      await scheduler.cancelRequested(task.id);
      if (task.status === 'pending') await store.put('intentions', { ...task, status: 'expired' });
    }
  }
}

/** A finished headless callback is not proof of delivery: the durable task is authoritative. */
export async function executeIntentionWork(
  store: Storage,
  run: (id: string) => Promise<void>,
  id: string,
): Promise<boolean> {
  const task = await store.get('intentions', id);
  if (!task) return true;
  if (task.status !== 'pending') {
    if ((await store.get('notifications', `agent:${id}`))?.status !== 'pending') return true;
    await run(id);
    return (await store.get('notifications', `agent:${id}`))?.status !== 'pending';
  }
  if (
    task.type !== 'requested' &&
    !(await store.get('settings', task.characterId))?.proactiveEnabled
  )
    return true;
  await run(id);
  const fresh = await store.get('intentions', id);
  if (fresh?.status === 'pending') return false;
  // DSH may have finished composing while its durable notification outbox still needs OS delivery.
  return (await store.get('notifications', `agent:${id}`))?.status !== 'pending';
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
