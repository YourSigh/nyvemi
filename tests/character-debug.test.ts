import { expect, it } from 'vitest';
import { CharacterDebugController } from '../src/character/debug';
import { characterStates } from '../src/character/interaction';
import { characterMotions } from '../src/character/motion-scheduler';
it('provides all manual states and distinct one-shot commands without leaking to another character or normal mode', () => {
  let now = 1000;
  const controller = new CharacterDebugController(() => now);
  for (const state of characterStates) {
    controller.setState('a', state);
    expect(controller.read('a', true)?.state).toBe(state);
  }
  let previous = 0;
  for (const motion of characterMotions) {
    controller.play('a', motion);
    const value = controller.read('a', true)!;
    expect(value.command?.name).toBe(motion);
    expect(value.command!.id).toBeGreaterThan(previous);
    previous = value.command!.id;
  }
  expect(controller.read('b', true)).toBeUndefined();
  expect(controller.read('a', false)).toBeUndefined();
  now += 60001;
  expect(controller.read('a', true)).toBeUndefined();
});
it('clears renderer overrides and releases observers independently of persistent character state', () => {
  const controller = new CharacterDebugController();
  let calls = 0;
  const stop = controller.subscribe(() => calls++);
  controller.setState('a', 'thinking');
  controller.clear('a');
  stop();
  controller.setState('a', 'talking');
  expect(calls).toBe(2);
  controller.clear('a');
  expect(controller.read('a', true)).toBeUndefined();
});
