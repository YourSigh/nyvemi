import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { getRuntime } from '../application/runtime';
import { runBackgroundCycle } from '../proactive/heartbeat/driver';
export const HEARTBEAT_TASK = 'nyvemi.heartbeat.v1';
TaskManager.defineTask(HEARTBEAT_TASK, async () => {
  let runtime: Awaited<ReturnType<typeof getRuntime>> | undefined;
  try {
    runtime = await getRuntime();
    await runBackgroundCycle(runtime);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    try {
      await runtime?.diagnostics.error('system', 'background_cycle');
    } catch {
      /* Storage may itself be unavailable. */
    }
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});
export async function registerHeartbeat(): Promise<void> {
  if (!(await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK)))
    await BackgroundTask.registerTaskAsync(HEARTBEAT_TASK, { minimumInterval: 60 });
}
