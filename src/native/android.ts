import type { NativeDeliveryState } from '../proactive/delivery-report';
import type { PresenceState } from '../presence/loop';
import { requireNativeModule } from 'expo';
import * as Notifications from 'expo-notifications';
import type { Character, NotificationRecord } from '../domain/models';
import type { NotificationGateway } from '../proactive/heartbeat/engine';
interface AndroidBridge {
  intentionWorkState(id: string): Promise<NativeDeliveryState>;
  scheduleRequested(id: string, characterId: string, dueAt: number): Promise<void>;
  cancelRequested(id: string): Promise<void>;
  cancelRequestedCharacter(characterId: string): Promise<void>;
  completeRequestedRun(runId: string, done: boolean): void;
  setNavigationBarDark(dark: boolean): Promise<void>;
  presenceState(): PresenceState;
  hasNetwork(): boolean;
  startPresence(characterId: string, name: string): Promise<void>;
  stopPresence(): void;
  updatePresence(characterId: string, name: string, text: string): void;
  canNotify(): boolean;
  openNotificationSettings(): Promise<void>;
  openBatterySettings(): Promise<void>;
  removeShortcut(characterId: string): void;
  notify(
    id: string,
    cid: string,
    name: string,
    body: string,
    avatar: string | null,
  ): Promise<boolean>;
  cancelNotification(id: string): void;
  pinShortcut(cid: string, name: string, avatar: string | null): Promise<boolean>;
}
export function bridge(): AndroidBridge {
  return requireNativeModule<AndroidBridge>('NyvemiAndroid');
}
export const androidNotifications: NotificationGateway = {
  enabled: async () => bridge().canNotify(),
  show: async (n: NotificationRecord, c: Character) => {
    if (!(await bridge().notify(n.id, c.id, c.persona.name, n.body, c.avatar ?? null)))
      throw new Error('系统未接收角色来信通知');
  },
  cancel: async (id) => {
    bridge().cancelNotification(id);
  },
};
export async function requestNotifications(): Promise<boolean> {
  await Notifications.setNotificationChannelAsync('nyvemi-companions-v1', {
    name: '角色来信',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  const permission = await Notifications.requestPermissionsAsync();
  return permission.granted;
}
export function pinCharacter(character: Character): Promise<boolean> {
  return bridge().pinShortcut(character.id, character.persona.name, character.avatar ?? null);
}

let launchRequest: Promise<void> | undefined;
export function requestNotificationsOnLaunch(): Promise<void> {
  return (launchRequest ??= (async () => {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'undetermined') await requestNotifications();
  })());
}
