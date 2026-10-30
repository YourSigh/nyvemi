import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../src/theme/context';
import { defaultPreference } from '../src/theme/model';
import type { ThemeRecord } from '../src/theme/model';
const native = vi.hoisted(() => ({
  prepareThemeTransition: vi.fn(),
  revealThemeTransition: vi.fn(),
  finishThemeTransition: vi.fn(),
}));
const lifecycle = vi.hoisted(() => ({
  background: undefined as ((state: string) => void) | undefined,
}));
vi.mock('../src/native/android', () => ({ bridge: () => native }));
vi.mock('../src/ui/keyboard', () => ({ closeKeyboard: async () => {} }));
vi.mock('react-native', () => ({
  View: 'View',
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => false,
    addEventListener: () => ({ remove: () => {} }),
  },
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, callback: (state: string) => void) => {
      lifecycle.background = callback;
      return {
        remove: () => {
          lifecycle.background = undefined;
        },
      };
    },
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
}));
let current: ReturnType<typeof useTheme>;
function Probe() {
  current = useTheme();
  return null;
}
let renderer: ReactTestRenderer | undefined;
const selected: ThemeRecord = {
  id: 'app',
  version: 1,
  preference: { ...defaultPreference, base: 'blue' },
  description: '淡蓝色',
  source: 'local',
  createdAt: 1,
};
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  native.prepareThemeTransition.mockReset().mockResolvedValue(true);
  native.revealThemeTransition.mockReset().mockResolvedValue(undefined);
  native.finishThemeTransition.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    renderer = create(createElement(ThemeProvider, null, createElement(Probe)));
  });
}
it('restores global touch interaction after a missing native capture callback and allows a retry', async () => {
  await mount();
  native.prepareThemeTransition.mockImplementationOnce(() => new Promise(() => {}));
  const persist = vi.fn(async () => {});
  let pending: Promise<string | void>;
  await act(async () => {
    pending = current.apply(selected, persist).catch((e: Error) => e.message);
  });
  expect(current.transitioning).toBe(true);
  expect(renderer!.root.findAllByProps({ testID: 'theme-interaction-lock' })).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(await pending!).toContain('超时');
  expect(current.transitioning).toBe(false);
  expect(renderer!.root.findAllByProps({ testID: 'theme-interaction-lock' })).toHaveLength(0);
  expect(persist).not.toHaveBeenCalled();
  let retry: Promise<void>;
  await act(async () => {
    retry = current.apply(selected, persist);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  await retry!;
  expect(current.record).toEqual(selected);
  expect(current.transitioning).toBe(false);
  expect(persist).toHaveBeenCalledOnce();
});
it('unlocks even if native reveal and cleanup both fail to return', async () => {
  await mount();
  native.revealThemeTransition.mockImplementation(() => new Promise(() => {}));
  native.finishThemeTransition.mockImplementation(() => new Promise(() => {}));
  let pending: Promise<string | void>;
  await act(async () => {
    pending = current.apply(selected, async () => {}).catch((e: Error) => e.message);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(await pending!).toContain('超时');
  expect(current.transitioning).toBe(false);
  expect(current.record).toEqual(selected);
});
it('cancels backgrounded transitions and scopes cleanup to the matching native operation', async () => {
  await mount();
  native.prepareThemeTransition.mockImplementation(() => new Promise(() => {}));
  let pending: Promise<string | void>;
  await act(async () => {
    pending = current.apply(selected, async () => {}).catch((e: Error) => e.message);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  const operationId = native.prepareThemeTransition.mock.calls[0][0];
  await act(async () => {
    lifecycle.background?.('background');
  });
  expect(await pending!).toContain('取消');
  expect(current.transitioning).toBe(false);
  expect(current.record).toBeUndefined();
  expect(native.finishThemeTransition).toHaveBeenCalledWith(operationId);
});
