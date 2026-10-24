import { expect, it } from 'vitest';
import {
  runThemeTransition,
  THEME_REVEAL_MS,
  type ThemeTransitionPorts,
} from '../src/theme/transition';
function ports(overrides: Partial<ThemeTransitionPorts> = {}) {
  const events: string[] = [];
  return {
    events,
    api: {
      prepare: async () => {
        events.push('capture');
        return true;
      },
      persist: async () => {
        events.push('persist');
      },
      commit: () => {
        events.push('commit');
      },
      paint: async () => {
        events.push('paint');
      },
      reveal: async (duration) => {
        expect(duration).toBe(THEME_REVEAL_MS);
        expect(duration).toBeGreaterThanOrEqual(2000);
        events.push('diagonal_reveal');
      },
      release: async () => {
        events.push('release');
      },
      ...overrides,
    } satisfies ThemeTransitionPorts,
  };
}
it('captures before changing colors and waits for the new screen to paint before revealing', async () => {
  const { events, api } = ports();
  await runThemeTransition(api);
  expect(events).toEqual(['capture', 'persist', 'commit', 'paint', 'diagonal_reveal', 'release']);
});
it('does not silently hard-cut or save the new theme if capture is unavailable', async () => {
  const { events, api } = ports({ prepare: async () => false });
  await expect(runThemeTransition(api)).rejects.toThrow('特效');
  expect(events).toEqual(['release']);
});
it('keeps the old colors and releases the screen if saving fails', async () => {
  const { events, api } = ports({
    persist: async () => {
      throw new Error('database busy');
    },
  });
  await expect(runThemeTransition(api)).rejects.toThrow('database busy');
  expect(events).toEqual(['capture', 'release']);
});
it('releases the overlay after interrupted native playback', async () => {
  const { events, api } = ports({
    reveal: async () => {
      throw new Error('interrupted');
    },
  });
  await expect(runThemeTransition(api)).rejects.toThrow('interrupted');
  expect(events.at(-1)).toBe('release');
});
it('respects reduced-motion mode without requiring native capture', async () => {
  const { events, api } = ports();
  await runThemeTransition(api, false);
  expect(events).toEqual(['persist', 'commit']);
});
