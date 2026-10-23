import { afterEach, expect, it, vi } from 'vitest';
import { safeSnapshot } from '../src/theme/capture';
afterEach(() => vi.useRealTimers());
it('uses an available native snapshot without leaving a timer behind', async () => {
  vi.useFakeTimers();
  expect(
    await safeSnapshot(
      async () => 'file://snapshot',
      () => {},
    ),
  ).toBe('file://snapshot');
  expect(vi.getTimerCount()).toBe(0);
});
it('falls back when native capture hangs, releasing a file that arrives too late', async () => {
  vi.useFakeTimers();
  let complete!: (uri: string) => void;
  const release = vi.fn();
  const result = safeSnapshot(
    () =>
      new Promise<string>((resolve) => {
        complete = resolve;
      }),
    release,
  );
  await vi.advanceTimersByTimeAsync(901);
  expect(await result).toBeUndefined();
  complete('file://late-snapshot');
  await Promise.resolve();
  await Promise.resolve();
  expect(release).toHaveBeenCalledWith('file://late-snapshot');
});
it('allows themes to change when native capture rejects', async () => {
  expect(
    await safeSnapshot(
      async () => {
        throw new Error('unsupported surface');
      },
      () => {},
    ),
  ).toBeUndefined();
});
