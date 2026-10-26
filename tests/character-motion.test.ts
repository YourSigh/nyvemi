import { expect, it } from 'vitest';
import { CharacterMotionScheduler } from '../src/character/motion-scheduler';
it('blinks at variable 2–6 second intervals and never catches up with a burst after pause', () => {
  const samples = [0, 0.5, 1, 0.25];
  let n = 0;
  const scheduler = new CharacterMotionScheduler(() => samples[n++ % samples.length]);
  scheduler.start(0);
  expect(scheduler.nextAt()).toBe(2000);
  expect(scheduler.tick(1999)).toBeUndefined();
  expect(scheduler.tick(2000)).toBe('blink');
  expect(scheduler.nextAt()).toBe(6000);
  scheduler.stop();
  expect(scheduler.tick(100000)).toBeUndefined();
  scheduler.start(100000);
  expect(scheduler.nextAt()).toBe(106000);
  expect(scheduler.tick(100000)).toBeUndefined();
});

it('spaces optional gestures far apart and suppresses them while listening or thinking', () => {
  const scheduler = new CharacterMotionScheduler(() => 0);
  scheduler.start(0);
  const gestures: number[] = [];
  for (let t = 0; t <= 90000; t += 100) {
    const action = scheduler.tick(t);
    if (action && action !== 'blink') gestures.push(t);
  }
  expect(gestures.length).toBeGreaterThan(0);
  for (let i = 1; i < gestures.length; i++)
    expect(gestures[i] - gestures[i - 1]).toBeGreaterThanOrEqual(18000);
  const focused = new CharacterMotionScheduler(() => 0);
  focused.start(0);
  for (let t = 0; t < 60000; t += 100)
    expect(['blink', undefined]).toContain(focused.tick(t, 'thinking'));
  focused.occupy(60000, 850);
  expect(focused.tick(60001)).toBeUndefined();
  expect(focused.nextAt()).toBeGreaterThanOrEqual(60850);
});
