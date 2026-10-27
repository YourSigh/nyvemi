import { expect, it, vi, afterEach } from 'vitest';
import { VoiceHold, type VoicePhase } from '../src/voice/hold';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(start = async () => {}) {
  let now = 1000;
  const text = vi.fn(),
    abort = vi.fn(async () => {}),
    finish = vi.fn(async () => '听清的文字');
  const states: VoicePhase[] = [];
  const h = new VoiceHold({
    start,
    finish,
    abort,
    text,
    error: vi.fn(),
    state: (s) => states.push(s),
    now: () => now,
  });
  return {
    h,
    text,
    abort,
    finish,
    states,
    advance: () => {
      now += 1000;
    },
  };
}
afterEach(() => vi.useRealTimers());
it('sends recognized text only after release and keeps cancellation reversible while held', async () => {
  const f = fixture();
  await f.h.begin(200);
  f.advance();
  f.h.move(100);
  expect(f.states.at(-1)).toBe('canceling');
  f.h.move(190);
  f.h.release();
  await Promise.resolve();
  expect(f.text).toHaveBeenCalledWith('听清的文字');
  expect(f.finish).toHaveBeenCalledTimes(1);
});
it('slide-up release and system termination discard results without finishing a send', async () => {
  const f = fixture();
  await f.h.begin(200);
  f.advance();
  f.h.move(100);
  f.h.release();
  expect(f.finish).not.toHaveBeenCalled();
  expect(f.text).not.toHaveBeenCalled();
  expect(f.abort).toHaveBeenCalledTimes(1);
  await f.h.begin(200);
  f.h.cancel();
  expect(f.abort).toHaveBeenCalledTimes(2);
});
it('aborts a late-starting recognizer after release cancellation', async () => {
  const pending = deferred<void>(),
    f = fixture(() => pending.promise);
  const begin = f.h.begin(100);
  f.h.release();
  pending.resolve();
  await begin;
  expect(f.text).not.toHaveBeenCalled();
  expect(f.abort).toHaveBeenCalled();
});
it('does not send late recognition after backgrounding or a theme transition', async () => {
  const pending = deferred<string>(),
    f = fixture();
  f.finish.mockImplementation(() => pending.promise);
  await f.h.begin(200);
  f.advance();
  f.h.release();
  f.h.cancel();
  pending.resolve('不应发送');
  await Promise.resolve();
  expect(f.text).not.toHaveBeenCalled();
});
it('keeps a pending gesture cancellable then resumes when moved back before native startup finishes', async () => {
  const pending = deferred<void>(),
    f = fixture(() => pending.promise);
  const begin = f.h.begin(200);
  f.advance();
  f.h.move(100);
  pending.resolve();
  await begin;
  expect(f.states.at(-1)).toBe('canceling');
  f.h.move(195);
  f.h.release();
  await Promise.resolve();
  expect(f.text).toHaveBeenCalled();
});
it('finishes a long hold once at the limit and ignores a later physical release', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.h.begin(200);
  f.advance();
  await vi.advanceTimersByTimeAsync(60_000);
  f.h.release();
  expect(f.finish).toHaveBeenCalledTimes(1);
  expect(f.text).toHaveBeenCalledTimes(1);
});
