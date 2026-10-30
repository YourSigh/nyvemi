import { afterEach, expect, it, vi } from 'vitest';
import {
  runThemeTransition,
  THEME_REVEAL_MS,
  type ThemeTransitionPorts,
} from '../src/theme/transition';
afterEach(() => vi.useRealTimers());
function ports(overrides: Partial<ThemeTransitionPorts> = {}) {
  const events: string[] = [];
  return {
    events,
    api: {
      settleInput: async () => {
        events.push('keyboard_closed');
      },
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
  expect(events).toEqual([
    'keyboard_closed',
    'capture',
    'persist',
    'commit',
    'paint',
    'diagonal_reveal',
    'release',
  ]);
});
it('does not silently hard-cut or save the new theme if capture is unavailable', async () => {
  const { events, api } = ports({ prepare: async () => false });
  await expect(runThemeTransition(api)).rejects.toThrow('特效');
  expect(events).toEqual(['keyboard_closed', 'release']);
});
it('keeps the old colors and releases the screen if saving fails', async () => {
  const { events, api } = ports({
    persist: async () => {
      throw new Error('database busy');
    },
  });
  await expect(runThemeTransition(api)).rejects.toThrow('database busy');
  expect(events).toEqual(['keyboard_closed', 'capture', 'release']);
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
  expect(events).toEqual(['keyboard_closed', 'persist', 'commit', 'release']);
});

it('never captures or saves before keyboard settling succeeds and still releases on failure', async () => {
  const { events, api } = ports({
    settleInput: async () => {
      throw new Error('keyboard interrupted');
    },
  });
  await expect(runThemeTransition(api)).rejects.toThrow('keyboard interrupted');
  expect(events).toEqual(['release']);
});

it.each(['settleInput', 'prepare', 'persist', 'paint', 'reveal'] as const)(
  'unlocks after a stalled %s callback and permits the next transition',
  async (stage) => {
    vi.useFakeTimers();
    const { events, api } = ports({ [stage]: () => new Promise(() => {}) });
    const result = runThemeTransition(api).then(
      () => 'done',
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(15000);
    expect(await result).toContain('超时');
    expect(events.at(-1)).toBe('release');
    if (['settleInput', 'prepare', 'persist'].includes(stage))
      expect(events).not.toContain('commit');
    const retry = ports();
    await runThemeTransition(retry.api);
    expect(retry.events).toContain('diagonal_reveal');
  },
);
it('does not wait forever for native cleanup itself', async () => {
  vi.useFakeTimers();
  const { api } = ports({ release: () => new Promise(() => {}) });
  const result = runThemeTransition(api);
  await vi.advanceTimersByTimeAsync(1500);
  await expect(result).resolves.toBeUndefined();
});
it('cancels an interrupted transition without committing a late capture', async () => {
  vi.useFakeTimers();
  let captured: (ready: boolean) => void = () => {};
  const controller = new AbortController();
  const { events, api } = ports({
    prepare: () =>
      new Promise((resolve) => {
        captured = resolve;
      }),
  });
  const result = runThemeTransition(api, true, controller.signal).catch((e: Error) => e.message);
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  expect(await result).toContain('取消');
  captured(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(events).toEqual(['keyboard_closed', 'release']);
});
