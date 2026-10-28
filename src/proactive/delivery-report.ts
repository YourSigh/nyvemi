import { backgroundSnapshot, type BackgroundHealth } from './background-health';
import { interactionState } from '../conversation/context';
import type { Storage } from '../storage/store';
export interface NativeDeliveryState {
  stage: string;
  scheduledAt: number;
  startedAt: number;
  finishedAt: number;
  outcome: string;
  source: string;
  workStates: string[];
  attempts: number;
}
/** Explicit allowlist: no prompts, persona, text, provider URL, errors or credentials leave the app. */
export async function deliveryReport(
  store: Storage,
  characterId: string,
  native: (id: string) => Promise<NativeDeliveryState>,
  environment: {
    notifications: boolean;
    online: boolean;
    presenceRunning: boolean;
    background?: BackgroundHealth;
  },
  now = Date.now(),
) {
  const tasks = (await store.list('intentions', characterId, 100)).slice(0, 12);
  const logs = await store.list('diagnostics', characterId, 200);
  const notifications = await store.list('notifications', characterId, 100);
  const settings = await store.get('settings', characterId);
  const interaction = interactionState(
    await store.list('messages', characterId, 100),
    notifications,
    now,
  );
  const states = [];
  for (const task of tasks) {
    const state = await native(task.id).catch(() => undefined);
    const log = logs.find((l) => l.kind === 'heartbeat' && l.data.intentionId === task.id);
    const sent = notifications.find(
      (n) => n.id === `${task.type}:${task.id}` || n.id === log?.data.notificationId,
    );
    states.push({
      type: task.type,
      status: task.status,
      createdAt: task.createdAt,
      dueAt: task.earliestAt,
      expiresAt: task.latestAt,
      attempts: task.attempts ?? 0,
      decision: typeof log?.data.decision === 'string' ? log.data.decision : undefined,
      reason: typeof log?.data.reason === 'string' ? log.data.reason : undefined,
      checkedAt: log?.createdAt,
      notificationStatus: sent?.status,
      native: state
        ? {
            stage: state.stage,
            scheduledAt: state.scheduledAt,
            startedAt: state.startedAt,
            finishedAt: state.finishedAt,
            outcome: state.outcome,
            source: state.source,
            workStates: state.workStates,
            attempts: state.attempts,
          }
        : { stage: 'status_unavailable' },
    });
  }
  return {
    reportVersion: 2,
    generatedAt: now,
    environment: {
      notifications: environment.notifications,
      online: environment.online,
      presenceRunning: environment.presenceRunning,
      background: environment.background ? backgroundSnapshot(environment.background) : undefined,
    },
    unansweredProactiveMessages: interaction.unansweredCount,
    silentMinutes: interaction.silentMinutes,
    proactiveEnabled: settings?.proactiveEnabled ?? false,
    quietHours: settings ? [settings.quietStart, settings.quietEnd] : [],
    tasks: states,
  };
}
export type DeliveryReport = Awaited<ReturnType<typeof deliveryReport>>;
export function deliverySummary(report: DeliveryReport): string {
  if (!report.environment.notifications) return '系统或角色来信通知未开启';
  if (
    !report.proactiveEnabled &&
    !report.tasks.some((t) => t.type === 'requested' && t.status === 'pending')
  )
    return '自主来信已关闭';
  if (report.unansweredProactiveMessages >= 2) return '她已经主动说过几次，正等你接话';
  if (!report.tasks.length) return '目前还没有留下后续话题；说过几句不代表一定会主动来信';
  if (!report.environment.online) return '当前离线，来信会等网络恢复后继续';
  const pending = report.tasks.find(
    (t) => t.status === 'pending' && t.expiresAt > report.generatedAt,
  );
  if (!pending) return '已有话题已处理或过期，等待新的后续念头';
  if (!pending.native.workStates?.length)
    return '有待续话题，但尚未查到 Android 后台任务，请修复任务登记';
  if (
    'outcome' in pending.native &&
    ['runtime_error', 'runtime_timeout', 'runtime_unavailable'].includes(
      pending.native.outcome ?? '',
    )
  )
    return 'Android 已尝试唤醒，但后台运行失败；诊断中保留了失败阶段';
  if (pending.dueAt > report.generatedAt) return '已留下后续话题，后台任务正在等合适的时间';
  return pending.reason === 'quiet_hours'
    ? '后续话题遇到安静时段，暂不打扰'
    : '后续话题已到时间，等待后台判断或重试';
}
