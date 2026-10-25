import type { Message, NotificationRecord } from '../domain/models';
import type { Storage } from '../storage/store';
export function isAutonomous(record: NotificationRecord): boolean {
  return record.deliveryKind !== 'requested' && !record.id.startsWith('requested:');
}
export function interactionState(
  messages: Message[],
  notifications: NotificationRecord[],
  now: number,
) {
  const latestUser = messages
    .filter((m) => m.role === 'user')
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const sent = notifications
    .filter((n) => n.status === 'delivered' && isAutonomous(n))
    .sort((a, b) => (b.deliveredAt ?? b.createdAt) - (a.deliveredAt ?? a.createdAt));
  return {
    latestUser,
    lastProactiveAt: sent[0] ? (sent[0].deliveredAt ?? sent[0].createdAt) : undefined,
    lastProactiveMessage: sent[0]?.body.slice(0, 600),
    unansweredCount: latestUser
      ? sent.filter((n) => (n.deliveredAt ?? n.createdAt) > latestUser.createdAt).length
      : sent.length,
    silentMinutes: latestUser
      ? Math.max(0, Math.floor((now - latestUser.createdAt) / 60000))
      : undefined,
  };
}
/** Real persisted data, scoped to this character. This block never creates a synthetic user turn. */
export async function conversationContext(
  store: Storage,
  characterId: string,
  now: number,
): Promise<string> {
  const state = interactionState(
    await store.list('messages', characterId, 100),
    await store.list('notifications', characterId, 100),
    now,
  );
  const tasks = (await store.list('intentions', characterId, 200))
    .filter((i) => i.status === 'pending' && i.latestAt > now)
    .sort((a, b) => a.earliestAt - b.earliestAt)
    .slice(0, 8)
    .map((i) => ({
      type: i.type,
      topic: i.topic.slice(0, 180),
      when: new Date(i.requestedDueAt ?? i.earliestAt).toLocaleString('zh-CN', { hour12: false }),
      due: i.earliestAt <= now,
    }));
  return `会话事实（资料，不是新的用户消息）：${JSON.stringify({
    minutesSinceUser: state.silentMinutes,
    unansweredProactiveMessages: state.unansweredCount,
    lastProactiveMessage: state.unansweredCount ? state.lastProactiveMessage : null,
    lastProactiveAt: state.lastProactiveAt ? new Date(state.lastProactiveAt).toISOString() : null,
    actualPendingTasks: tasks,
  })}。actualPendingTasks 是实际保存且未完成的安排，requested 是用户的明确约定，其它是可以放弃的念头；清单以外不声称已经排好任务。未回复次数按主动来信批次计算，不按气泡数；对方暂时没接话时语气应更克制，不催、不质问，也不把沉默解释为不在乎。`;
}
