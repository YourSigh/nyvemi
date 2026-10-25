import type { NotificationRecord, Settings } from '../../domain/models';
import { isQuietHour } from '../quiet-hours';
export function localDayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
export function policyBlock(
  settings: Settings,
  notifications: NotificationRecord[],
  now: number,
): string | undefined {
  if (!settings.proactiveEnabled) return 'proactive_disabled';
  if (isQuietHour(now, settings.quietStart, settings.quietEnd)) return 'quiet_hours';
  if (now - settings.lastActiveAt < settings.recentActiveMinutes * 60000)
    return 'recent_active_chat';
  const sent = notifications.filter(
    (n) =>
      n.status === 'delivered' &&
      n.deliveryKind !== 'continuation' &&
      n.deliveryKind !== 'requested' &&
      !n.id.startsWith('requested:') &&
      !n.id.startsWith('continuation:'),
  );
  const today = sent.filter((n) => localDayKey(n.createdAt) === localDayKey(now));
  if (today.filter((n) => n.characterId === settings.characterId).length >= settings.dailyLimit)
    return 'daily_limit';
  if (today.length >= 4) return 'global_daily_limit';
  const last = sent
    .filter((n) => n.characterId === settings.characterId)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (last && now - last.createdAt < settings.minIntervalMinutes * 60000) return 'minimum_interval';
  const globalLast = sent.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (globalLast && now - globalLast.createdAt < 30 * 60000) return 'global_minimum_interval';
  return undefined;
}
