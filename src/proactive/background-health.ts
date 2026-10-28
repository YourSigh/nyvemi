export interface BackgroundRunState {
  stage: string;
  source: string;
  startedAt: number;
  finishedAt: number;
  updatedAt: number;
}
export interface BackgroundHealth {
  fast: BackgroundRunState;
  full: BackgroundRunState;
  workStates: string[];
  batteryUnrestricted: boolean;
  deviceIdle: boolean;
}
/** Explicit export allowlist, including native fields; never forward a raw bridge object. */
export function backgroundSnapshot(value: BackgroundHealth): BackgroundHealth {
  const snapshot = (run: BackgroundRunState): BackgroundRunState => ({
    stage: run.stage,
    source: run.source,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
  });
  return {
    fast: snapshot(value.fast),
    full: snapshot(value.full),
    workStates: value.workStates,
    batteryUnrestricted: value.batteryUnrestricted,
    deviceIdle: value.deviceIdle,
  };
}
export function backgroundSummary(
  state: BackgroundHealth,
  presenceRunning: boolean,
  now = Date.now(),
): string {
  if (!state.workStates.length) return '后台任务未登记，请修复后台任务';
  const latest = [state.fast, state.full].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (['runtime_error', 'runtime_unavailable', 'runtime_timeout'].includes(latest.stage))
    return '最近一次后台执行失败，已保留失败阶段';
  if (state.deviceIdle && !state.batteryUnrestricted) return '系统正在省电休眠，后台检查可能延迟';
  if (presenceRunning && (!state.fast.updatedAt || now - state.fast.updatedAt > 4 * 60000))
    return '常驻通知还在，但近期未完成检查；可关闭后重新开启常驻陪伴';
  if (latest.stage === 'running_js' || latest.stage === 'starting_runtime')
    return '正在检查待续话题';
  if (latest.stage === 'retry_pending') return '上次后台检查未完成，正在等待重试';
  if (latest.stage === 'finished') {
    const time = new Date(latest.finishedAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${time} 已执行后台检查${presenceRunning ? '' : ' · 常驻陪伴未开启'}`;
  }
  return presenceRunning ? '常驻陪伴已开启，等待检查' : '已登记后台检查 · 常驻陪伴未开启';
}
