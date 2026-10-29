import { isThemeChangeRequest } from '../theme/chat-request';
import type { Intention, Message, NotificationRecord, Settings } from '../domain/models';
import type { Storage } from '../storage/store';
import { interactionState } from '../conversation/context';
import { policyBlock } from './policies';
import { nextOutsideQuietHours } from './quiet-hours';
export function asksForSpace(text: string): boolean {
  const direct = text.replace(/[“「『"][^”」』"]*[”」』"]/g, '');
  return (
    /(?:别|不要|不用|先别)(?:再)?(?:主动)?(?:找我|联系我|打扰我|发消息|回我|回复)|(?:我|先|准备|要)(?:去)?睡(?:觉|了)|今天先到这|不聊了|让我静静/.test(
      direct,
    ) || /(?:^|[，。！!？?\s])晚安(?:啦|呀|哦)?[~～。.!！\s]*$/.test(direct)
  );
}
export function reconnectDelay(messageId: string): number {
  let hash = 0;
  for (const ch of messageId) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return (12 + (hash % 14)) * 60000;
}
/** One durable evaluation per meaningful user turn; evaluation is not a promise to send. */
export async function planReconnect(store: Storage, user: Message, now: number): Promise<void> {
  const tasks = await store.list('intentions', user.characterId, 10000);
  for (const old of tasks)
    if (old.type === 'reconnect' && old.status === 'pending' && old.sourceMessageId !== user.id)
      await store.put('intentions', { ...old, status: 'cancelled' });
  const settings = await store.get('settings', user.characterId);
  if (
    !settings?.proactiveEnabled ||
    settings.dailyLimit === 0 ||
    asksForSpace(user.content) ||
    isThemeChangeRequest(user.content)
  )
    return;
  const compact = user.content.replace(/[\s，。？！!?~～]/g, '');
  if (compact.length < 6 || /^(你好|早上好|晚上好|在吗|哈哈|谢谢|好的|好呀|嗯嗯)+$/.test(compact))
    return;
  // Also recognizes remapped terminal tasks in an imported bundle: never revive a declined thought.
  if (tasks.some((t) => t.type === 'reconnect' && t.sourceMessageId === user.id)) return;
  const due = nextOutsideQuietHours(
    now + reconnectDelay(user.id),
    settings.quietStart,
    settings.quietEnd,
  );
  await store.put('intentions', {
    id: `reconnect:${user.id}`,
    characterId: user.characterId,
    type: 'reconnect',
    sourceMessageId: user.id,
    topic: user.content.slice(0, 300),
    reason: '聊过一段后，稍后再看是否还有具体想接着说的事；可保持安静，不预写消息',
    earliestAt: due,
    latestAt: due + 6 * 3600000,
    importance: 0.6,
    status: 'pending',
    createdAt: user.createdAt,
  });
}
export async function recoverReconnects(store: Storage, now = Date.now()): Promise<void> {
  for (const c of await store.list('characters')) {
    await store.atomic(async (tx) => {
      const messages = await tx.list('messages', c.id, 100);
      const user = messages.find((m) => m.role === 'user');
      if (
        !user ||
        user.status !== 'complete' ||
        user.replyDisposition === 'silence' ||
        now - user.createdAt > 6 * 3600000 ||
        user.createdAt > now
      )
        return;
      const reply = messages.some(
        (m) =>
          m.role === 'assistant' &&
          m.origin === 'chat' &&
          m.status === 'complete' &&
          !m.id.startsWith('ack:') &&
          m.createdAt >= user.createdAt,
      );
      if (reply) await planReconnect(tx, user, user.createdAt);
    });
  }
}
export async function autonomousBlock(
  store: Storage,
  characterId: string,
  records: NotificationRecord[],
  now: number,
): Promise<string | undefined> {
  if ((await store.get('characters', characterId))?.state.contactMode === 'quiet')
    return 'user_wants_space';
  const state = interactionState(
    await store.list('messages', characterId, 100),
    records.filter((n) => n.characterId === characterId),
    now,
  );
  if (state.latestUser && asksForSpace(state.latestUser.content)) return 'user_wants_space';
  if (state.unansweredCount >= 2) return 'awaiting_user_reply';
  return undefined;
}
export async function reconnectBlock(
  store: Storage,
  task: Intention,
  settings: Settings | undefined,
  records: NotificationRecord[],
  now: number,
): Promise<string | undefined> {
  if (!settings?.proactiveEnabled) return 'proactive_disabled';
  const state = interactionState(
    await store.list('messages', task.characterId, 100),
    records.filter((n) => n.characterId === task.characterId),
    now,
  );
  if (
    !state.latestUser ||
    state.latestUser.id !== task.sourceMessageId ||
    state.latestUser.status !== 'complete'
  )
    return 'reconnect_superseded';
  const blocked = await autonomousBlock(store, task.characterId, records, now);
  if (blocked) return blocked;
  const specific = (await store.list('intentions', task.characterId, 200)).some(
    (i) =>
      i.type !== 'reconnect' &&
      i.status === 'pending' &&
      i.latestAt > now &&
      i.earliestAt <= now + 5 * 60000 &&
      (i.importance >= 0.65 || i.type === 'requested' || i.type === 'continuation'),
  );
  if (specific) return 'reconnect_specific_intention';
  if (now - state.latestUser.createdAt < 12 * 60000) return 'reconnect_recent_message';
  if (state.lastProactiveAt && now - state.lastProactiveAt < 20 * 60000)
    return 'reconnect_recent_proactive';
  // User-message inactivity is checked above; merely viewing the app is not another chat turn.
  return policyBlock({ ...settings, lastActiveAt: now - 86400000 }, records, now);
}
