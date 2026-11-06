import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCocoonMotion } from '../src/ui/character/cocoon-motion';
const native = vi.hoisted(() => ({
  reduced: false,
  configs: [] as Record<string, unknown>[],
  listeners: new Map<string, (value: never) => void>(),
  loops: [] as { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[],
  timings: [] as { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[],
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (name: string, callback: (v: never) => void) => {
      native.listeners.set(name, callback);
      return { remove: () => native.listeners.delete(name) };
    },
  },
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => native.reduced,
    addEventListener: (name: string, callback: (v: never) => void) => {
      native.listeners.set(name, callback);
      return { remove: () => native.listeners.delete(name) };
    },
  },
  Easing: { linear: (value: number) => value },
  Animated: {
    Value: class {
      setValue = vi.fn();
    },
    timing: (_value: unknown, config: Record<string, unknown>) => {
      native.configs.push(config);
      const animation = { start: vi.fn(), stop: vi.fn() };
      native.timings.push(animation);
      return animation;
    },
    sequence: (parts: unknown[]) => ({ parts }),
    loop: () => {
      const animation = { start: vi.fn(), stop: vi.fn() };
      native.loops.push(animation);
      return animation;
    },
  },
}));
let screen: ReactTestRenderer | undefined;
let motion: ReturnType<typeof useCocoonMotion>;
function Probe({ animated = true }) {
  motion = useCocoonMotion(animated, 'idle');
  return null;
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  native.reduced = false;
  native.configs.length = 0;
  native.listeners.clear();
  native.loops.length = 0;
  native.timings.length = 0;
});
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  vi.useRealTimers();
});
const emit = async (name: string, value: unknown) =>
  act(async () => native.listeners.get(name)!(value as never));
const mount = async (animated = true) =>
  act(async () => {
    screen = create(createElement(Probe, { animated }));
  });
it('shows tap/hold feedback, pauses effects and clears touch timers in background, then resumes on return', async () => {
  await mount();
  expect(motion.moving).toBe(true);
  expect(native.loops).toHaveLength(2);
  expect(native.configs.every((config) => config.isInteraction === false)).toBe(true);
  expect(native.loops.every((loop) => loop.start.mock.calls.length === 1)).toBe(true);
  await act(async () => motion.soothe());
  expect(motion.soothing).toBe(true);
  expect(motion.flash).toBe(true);
  await act(async () => motion.release());
  expect(motion.soothing).toBe(false);
  await emit('change', 'background');
  expect(motion.moving).toBe(false);
  expect(motion.flash).toBe(false);
  expect(native.loops.every((loop) => loop.stop.mock.calls.length === 1)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await emit('change', 'active');
  expect(motion.moving).toBe(true);
  await act(async () => screen!.unmount());
  screen = undefined;
  expect(native.listeners.size).toBe(0);
  expect(native.loops.every((loop) => loop.stop.mock.calls.length === 1)).toBe(true);
});
it('uses static touch feedback with reduced motion and does not leave a stuck glow when toggled mid-touch', async () => {
  native.reduced = true;
  await mount();
  expect(motion.moving).toBe(false);
  expect(native.loops).toHaveLength(0);
  await act(async () => motion.tap());
  expect(motion.flash).toBe(true);
  await act(async () => {
    vi.advanceTimersByTime(800);
  });
  expect(motion.flash).toBe(false);
  await emit('reduceMotionChanged', false);
  expect(motion.moving).toBe(true);
  await act(async () => motion.tap());
  await emit('reduceMotionChanged', true);
  expect(motion.moving).toBe(false);
  await act(async () => {
    vi.advanceTimersByTime(800);
  });
  expect(motion.flash).toBe(false);
  expect(native.loops.every((loop) => loop.stop.mock.calls.length === 1)).toBe(true);
});
it('supports a static preview without starting animation loops or leaving a timer on unmount', async () => {
  await mount(false);
  expect(native.loops).toHaveLength(0);
  await act(async () => motion.tap());
  expect(motion.flash).toBe(true);
  await act(async () => screen!.unmount());
  screen = undefined;
  expect(vi.getTimerCount()).toBe(0);
  expect(native.listeners.size).toBe(0);
});
