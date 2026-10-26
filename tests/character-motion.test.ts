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
