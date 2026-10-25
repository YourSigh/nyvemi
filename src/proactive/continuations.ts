import type { Continuation } from '../chat/outcome';
import type { Intention, Message, NotificationRecord, Settings } from '../domain/models';
import type { Storage } from '../storage/store';
import { autonomousBlock } from './reconnect';
import { localDayKey } from './policies';
import { isQuietHour } from './quiet-hours';

export async function saveContinuation(
  store: Storage,
  user: Message,
  thought: Continuation,
  now: number,
): Promise<void> {
  const settings = await store.get('settings', user.characterId);
  if (!settings?.proactiveEnabled) return;
  for (const old of await store.list('intentions', user.characterId, 10000))
    if (old.type === 'continuation' && old.status === 'pending')
      await store.put('intentions', { ...old, status: 'cancelled' });
  await store.put('intentions', {
    id: `continuation:${user.id}`,
    characterId: user.characterId,
    type: 'continuation',
    sourceMessageId: user.id,
    topic: thought.topic,
    reason: thought.reason,
    earliestAt: now + thought.afterMinutes * 60000,
    latestAt: now + (thought.afterMinutes + 30) * 60000,
    importance: 0.75,
    status: 'pending',
    createdAt: now,
  });
}
export function isContinuation(record: NotificationRecord): boolean {
  return record.deliveryKind === 'continuation' || record.id.startsWith('continuation:');
}
export async function continuationBlock(
  store: Storage,
  task: Intention,
  settings: Settings | undefined,
  records: NotificationRecord[],
  now: number,
): Promise<string | undefined> {
  if (!settings?.proactiveEnabled) return 'proactive_disabled';
  const latestUser = (await store.list('messages', task.characterId, 100)).find(
    (m) => m.role === 'user',
  );
  if (!latestUser || latestUser.id !== task.sourceMessageId) return 'continuation_superseded';
  const blocked = await autonomousBlock(store, task.characterId, records, now);
  if (blocked) return blocked;
  if (isQuietHour(now, settings.quietStart, settings.quietEnd)) return 'quiet_hours';
  if (now - latestUser.createdAt < 90000) return 'continuation_recent_message';
  const sent = records.filter((r) => r.status === 'delivered' && isContinuation(r));
  if (settings.dailyLimit === 0) return 'daily_limit';
  if (sent.filter((r) => localDayKey(r.createdAt) === localDayKey(now)).length >= 6)
    return 'continuation_daily_limit';
  if (sent.filter((r) => now - r.createdAt < 3600000).length >= 2) return 'continuation_hour_limit';
  return undefined;
}
