import type { Character, Intention, Settings } from '../domain/models';
import { isQuietHour } from '../proactive/quiet-hours';
export interface PresenceState {
  enabled: boolean;
  running: boolean;
  characterId: string;
}
export function idleActivity(
  character: Character,
  settings: Settings,
  intentions: Intention[],
  now: number,
  online = true,
): string {
  if (!online) return '暂时离线，已保存的记忆还在这里';
  if (
    intentions.some(
      (i) =>
        i.characterId === character.id &&
        i.type === 'requested' &&
        i.status === 'pending' &&
        i.latestAt > now,
    )
  )
    return '记着和你约好的来信，到了时间再找你';
  if (!settings.proactiveEnabled) return '安静陪着你，主动来信尚未开启';
  if (isQuietHour(now, settings.quietStart, settings.quietEnd)) return '现在是安静时段，先不打扰你';
  if (now - settings.lastActiveAt < settings.recentActiveMinutes * 60000)
    return '刚刚聊过，先留一点自己的时间';
  if (
    intentions.some(
      (i) => i.characterId === character.id && i.status === 'pending' && i.latestAt > now,
    )
  )
    return '记着没聊完的事，等合适的时候再找你';
  return '安静待一会儿，有值得分享的小事再找你';
}
