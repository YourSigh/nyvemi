import type { Storage } from '../storage/store';
/** Screen focus survives backgrounding. Check visibility again inside the serialized write. */
export async function trackVisibleActivity(
  store: Storage,
  isActive: () => boolean,
  now = Date.now(),
): Promise<void> {
  if (!isActive()) return;
  await store.atomic(async (tx) => {
    const settings = await tx.list('settings');
    if (!isActive()) return;
    for (const row of settings) await tx.put('settings', { ...row, lastActiveAt: now });
  });
}
