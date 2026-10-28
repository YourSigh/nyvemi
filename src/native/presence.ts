import { AppState } from 'react-native';
import { bridge, requestNotifications } from './android';
import { getRuntime } from '../application/runtime';
import type { Character } from '../domain/models';
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
