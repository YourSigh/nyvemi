import { themeTask } from './task';
export const THEME_REVEAL_MS = 2200;
export interface ThemeTransitionPorts {
  settleInput(): Promise<void>;
  prepare(): Promise<boolean>;
  persist(signal?: AbortSignal): Promise<void>;
  commit(): void;
  paint(): Promise<void>;
  reveal(duration: number): Promise<void>;
  release(): Promise<void>;
}
/** Keep the old screen opaque until the new palette has committed and painted. */
export async function runThemeTransition(
  ports: ThemeTransitionPorts,
  animate = true,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await themeTask(() => ports.settleInput(), 1600, signal);
    if (!animate) {
      await themeTask((stage) => ports.persist(stage), 3000, signal);
      ports.commit();
      return;
    }
    if (!(await themeTask(() => ports.prepare(), 1600, signal)))
      throw new Error('换色特效还没准备好，请再试一下');
    await themeTask((stage) => ports.persist(stage), 3000, signal);
    ports.commit();
    await themeTask(() => ports.paint(), 1000, signal);
    await themeTask(() => ports.reveal(THEME_REVEAL_MS), THEME_REVEAL_MS + 1500, signal);
  } finally {
    await themeTask(() => ports.release(), 1000).catch(() => undefined);
  }
}
