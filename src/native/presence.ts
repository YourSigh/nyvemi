import { AppRegistry, AppState } from 'react-native';
import { bridge, requestNotifications } from './android';
import { getRuntime } from '../application/runtime';
import type { Character } from '../domain/models';
import { activityText } from '../presence/activity';
import { idleActivity, runPresenceLoop } from '../presence/loop';
import { runBackgroundCycle } from '../proactive/heartbeat/driver';
export async function startCompanionPresence(character: Character): Promise<void> {
  if (AppState.currentState !== 'active') throw new Error('请回到 App 后开启常驻陪伴');
  if (!(await requestNotifications()))
    throw new Error('常驻陪伴需要通知权限，请在系统设置中允许通知');
  await bridge().startPresence(character.id, character.persona.name);
}
export async function resumeCompanionPresence(): Promise<void> {
  if (AppState.currentState !== 'active') return;
  const state = bridge().presenceState();
  if (!state.enabled || state.running) return;
  const runtime = await getRuntime();
  const c = await runtime.store.get('characters', state.characterId);
  if (c) await bridge().startPresence(c.id, c.persona.name);
  else bridge().stopPresence();
}
let activeLoop: Promise<void> | undefined;
async function session(): Promise<void> {
  const runtime = await getRuntime();
  await runtime.syncIntentionWork();
  let updates = Promise.resolve();
  const unsubscribe = runtime.activity.subscribe((stage, cid) => {
    updates = updates
      .then(async () => {
        if (!bridge().presenceState().running) return;
        const c = await runtime.store.get(
          'characters',
          cid ?? bridge().presenceState().characterId,
        );
        if (c) bridge().updatePresence(c.id, c.persona.name, activityText[stage]);
      })
      .catch(() => undefined);
  });
  // Separate from the slower experience/extraction cycle: a network request there can take minutes.
  const requestedTimer = setInterval(() => {
    if (bridge().presenceState().running && bridge().hasNetwork())
      void runtime.heartbeat
        .runRequested()
        .then(() => runtime.heartbeat.runContinuations())
        .then(() => runtime.heartbeat.runReconnects())
        .catch(() => runtime.diagnostics.error('system', 'requested_tick'));
  }, 10000);
  try {
    await runPresenceLoop({
      state: () => bridge().presenceState(),
      online: () => bridge().hasNetwork(),
      now: Date.now,
      cycle: async () => {
        runtime.activity.report('checking');
        await runBackgroundCycle(runtime);
        await updates;
      },
      idle: async (online) => {
        const cid = bridge().presenceState().characterId;
        const c = await runtime.store.get('characters', cid);
        const settings = await runtime.store.get('settings', cid);
        if (!c || !settings) {
          bridge().stopPresence();
          return;
        }
        bridge().updatePresence(
          c.id,
          c.persona.name,
          idleActivity(
            c,
            settings,
            await runtime.store.list('intentions', cid, 10000),
            Date.now(),
            online,
          ),
        );
      },
      error: async () => {
        await runtime.diagnostics.error('system', 'presence_cycle');
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  } finally {
    clearInterval(requestedTimer);
    unsubscribe();
    await updates;
  }
}
AppRegistry.registerHeadlessTask('NyvemiPresence', () => () => {
  activeLoop ??= session()
    .catch(async () => {
      bridge().stopPresence();
      try {
        await (await getRuntime()).diagnostics.error('system', 'presence_session');
      } catch {
        /* Disk may be unavailable. */
      }
    })
    .finally(() => {
      activeLoop = undefined;
    });
  return activeLoop;
});
