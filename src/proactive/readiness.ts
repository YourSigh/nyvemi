import type { Settings, Intention, NotificationRecord } from '../domain/models';
import { policyBlock } from './policies';
const reasons: Record<string, string> = {
  proactive_disabled: '主动来信尚未开启',
  quiet_hours: '现在是安静时段，暂不打扰',
  recent_active_chat: '你刚刚在 App 里，离开一段时间后才会考虑来信',
  daily_limit: '今天的主动来信已达到上限',
  global_daily_limit: '今天的来信已达到 App 上限',
  minimum_interval: '距离上次来信太近，先安静一会儿',
  global_minimum_interval: '距离上次来信太近',
  notification_permission: '系统通知或“角色来信”渠道未开启',
  no_due_intention: '暂时没有到合适时间的后续话题',
  below_threshold: '有后续话题，但现在还不值得打扰',
  model_declined: '她判断这次先不发',
  generation_or_delivery_error: '上次来信生成或投递失败，请检查模型连接与通知设置',
  contextual_intention: '已根据之前的话题发来一条消息',
  outbox_recovered: '已恢复发送之前保存的消息',
};
export const proactiveReason = (reason: string): string => reasons[reason] ?? '等待合适的聊天机会';
export function proactiveReadiness(
  settings: Settings,
  intentions: Intention[],
  notifications: NotificationRecord[],
  canNotify: boolean,
  now: number,
): string {
  if (!canNotify) return proactiveReason('notification_permission');
  const block = policyBlock(settings, notifications, now);
  if (block) return proactiveReason(block);
  if (!intentions.some((i) => i.status === 'pending' && i.latestAt > now))
    return '还没有值得稍后跟进的事。聊到一次之后想分享结果的经历，或添加感兴趣的 RSS，会留下主动话题。';
  if (!intentions.some((i) => i.status === 'pending' && i.earliestAt <= now && i.latestAt > now))
    return '她记着还没聊完的事，正在等待适合的时间';
  return '有可以跟进的话题，下次后台检查会判断是否适合联系你';
}
