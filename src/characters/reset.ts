import type { Storage } from '../storage/store';
export interface CharacterCleanup {
  cancelRequested(characterId: string): Promise<void>;
  stop(characterId: string): Promise<void>;
  cancelNotification(id: string): Promise<void>;
  removeShortcut(characterId: string): Promise<void>;
  removeAvatar(uri: string): Promise<void>;
  removeAppearance?(): Promise<void>;
}
export async function resetCharacter(
  store: Storage,
  characterId: string,
  enteredName: string,
  cleanup: CharacterCleanup,
): Promise<void> {
  const c = await store.get('characters', characterId);
  if (!c) throw new Error('当前角色不存在');
  if (enteredName !== c.persona.name) throw new Error('请输入当前角色的完整名字，必须完全一致');
  const acquired: string[] = [];
  try {
    for (const name of [
      'visual-assets',
      `visual:${characterId}`,
      'background-cycle',
      'heartbeat',
      'requested-delivery',
      'agent-runtime',
      'memory-extraction',
      `chat:${characterId}`,
    ]) {
      if (!(await store.lease(name, Date.now(), 120000)))
        throw new Error('她正在处理一轮对话或后台任务，请稍后再重置');
      acquired.push(name);
    }
    const notifications = await store.list('notifications', characterId, 100000);
    const media = await store.list('mediaAssets', characterId, 10000);
    // Fail before deletion if the OS service cannot be stopped/cancelled.
    await cleanup.stop(characterId);
    await cleanup.cancelRequested(characterId);
    for (const n of notifications) await cleanup.cancelNotification(n.id);
    await cleanup.removeShortcut(characterId);
    await store.atomic(async (tx) => {
      const fresh = await tx.get('characters', characterId);
      if (fresh?.persona.name !== enteredName) throw new Error('角色已变化，请重新确认');
      await tx.eraseCharacter(characterId);
    });
    // File cleanup is retryable. Never report a destructive transaction as failed after it committed.
    if (c.avatar) await cleanup.removeAvatar(c.avatar).catch(() => undefined);
    for (const asset of media) await cleanup.removeAvatar(asset.uri).catch(() => undefined);
    await cleanup.removeAppearance?.().catch(() => undefined);
  } finally {
    for (const name of acquired.reverse()) await store.release(name);
  }
}
