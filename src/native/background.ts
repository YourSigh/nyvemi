import { AppRegistry, AppState } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { getRuntime } from '../application/runtime';
import { runBackgroundCycle } from '../proactive/heartbeat/driver';
import { runMaintenance } from '../proactive/heartbeat/maintenance';
import { activityText } from '../presence/activity';
import { idleActivity } from '../presence/loop';
import { bridge } from './android';
// Keep the legacy definition while upgrading/unregistering previously installed Expo work.
export const HEARTBEAT_TASK = 'nyvemi.heartbeat.v1';
async function executeMaintenance(full: boolean, source: string): Promise<boolean> {
  const runtime = await getRuntime();
  const startedAt = Date.now();
  await runtime.diagnostics
    .record('heartbeat', '', {
      event: 'maintenance_start',
      source,
      full,
      appState: AppState.currentState,
    })
    .catch(() => undefined);
  const unsubscribe = runtime.activity.subscribe((stage, cid) => {
    const state = bridge().presenceState();
    if (!state.running || (cid && state.characterId !== cid)) return;
    void runtime.store
      .get('characters', state.characterId)
      .then((c) => {
        if (c && bridge().presenceState().running)
          bridge().updatePresence(c.id, c.persona.name, activityText[stage]);
      })
      .catch(() => undefined);
  });
  try {
    const done = await runMaintenance(
      {
        requested: () => runtime.heartbeat.runRequested(),
        continuations: () => runtime.heartbeat.runContinuations(),
        reconnects: () => runtime.heartbeat.runReconnects(),
        cycle: () => runBackgroundCycle(runtime),
        sync: () => runtime.syncIntentionWork(),
        idle: async () => {
          const state = bridge().presenceState();
          if (!state.running) return;
          const c = await runtime.store.get('characters', state.characterId);
          const settings = await runtime.store.get('settings', state.characterId);
          if (!c || !settings) return bridge().stopPresence();
          bridge().updatePresence(
            c.id,
            c.persona.name,
            idleActivity(
              c,
              settings,
              await runtime.store.list('intentions', c.id, 10000),
              Date.now(),
              bridge().hasNetwork(),
            ),
          );
        },
        error: (operation) => runtime.diagnostics.error('', operation),
      },
      full,
    );
    await runtime.diagnostics
      .record('heartbeat', '', {
        event: 'maintenance_finish',
        source,
        full,
        success: done,
        duration: Date.now() - startedAt,
        appState: AppState.currentState,
      })
      .catch(() => undefined);
    return done;
  } finally {
    unsubscribe();
  }
}
AppRegistry.registerHeadlessTask(
  'NyvemiMaintenance',
  () => async (data: { runId: string; full: boolean; source: string }) => {
    let done = false;
    try {
      done = await executeMaintenance(data.full, data.source);
    } catch {
      /* Native receipt marks a retry; no provider error text is exposed. */
    } finally {
      bridge().completeMaintenanceRun(data.runId, done);
    }
  },
);
TaskManager.defineTask(HEARTBEAT_TASK, async () => {
  try {
    return (await executeMaintenance(true, 'legacy_expo'))
      ? BackgroundTask.BackgroundTaskResult.Success
      : BackgroundTask.BackgroundTaskResult.Failed;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});
export async function registerHeartbeat(): Promise<void> {
  // Register durably before retiring the old hourly Expo job. Safe to repeat on every startup.
  await bridge().registerMaintenance();
  if (await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK))
    await BackgroundTask.unregisterTaskAsync(HEARTBEAT_TASK);
}
