/** User explicitly affirmed usage rights for this exact persisted candidate. */
export async function applyLocalReference(
  deps: {
    state(): Promise<{ available: boolean; enabled: boolean }>;
    enable(enabled: boolean): Promise<unknown>;
    apply(cid: string, expectedId: string): Promise<unknown>;
  },
  cid: string,
  expectedId: string,
) {
  const before = await deps.state();
  if (!before.available) throw Error('本机模型尚未准备，原声未改变');
  if (!before.enabled) await deps.enable(true);
  try {
    await deps.apply(cid, expectedId);
  } catch (error) {
    if (!before.enabled) await deps.enable(false).catch(() => {});
    throw error;
  }
}
