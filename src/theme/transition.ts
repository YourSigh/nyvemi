export const THEME_REVEAL_MS = 2200;
export interface ThemeTransitionPorts {
  prepare(): Promise<boolean>;
  persist(): Promise<void>;
  commit(): void;
  paint(): Promise<void>;
  reveal(duration: number): Promise<void>;
  release(): Promise<void>;
}
/** Keep the old screen opaque until the new palette has committed and painted. */
export async function runThemeTransition(
  ports: ThemeTransitionPorts,
  animate = true,
): Promise<void> {
  if (!animate) {
    await ports.persist();
    ports.commit();
    return;
  }
  try {
    if (!(await ports.prepare())) throw new Error('换色特效还没准备好，请再试一下');
    await ports.persist();
    ports.commit();
    await ports.paint();
    await ports.reveal(THEME_REVEAL_MS);
  } finally {
    await ports.release().catch(() => undefined);
  }
}
