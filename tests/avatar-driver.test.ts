import { it, expect, vi } from 'vitest';
import { createDriver, pose, type MeshPlayer } from '../src/avatar/driver';
import { validateP2lrt } from '../src/avatar/model';
it('drives head, gaze, eyes, mouth and body through parameters, leaving physics outputs to the runtime', () => {
  const values = new Map<string, number>();
  const ids = [
    'ParamAngleX',
    'ParamAngleY',
    'ParamAngleZ',
    'ParamEyeBallX',
    'ParamEyeBallY',
    'ParamEyeLOpen',
    'ParamEyeROpen',
    'ParamMouthOpenY',
    'ParamMouthForm',
    'ParamBodyAngleZ',
  ];
  const player: MeshPlayer = {
    parameterRanges: () => ids.map((id) => ({ id, min: -30, max: 30, default: 0 })),
    setParameter: (id, v) => values.set(id, v),
    behaviors: vi.fn(),
    update: vi.fn(),
    draw: vi.fn(),
  };
  const driver = createDriver(player, () => 0.5);
  driver.setInput({ state: 'talking' });
  for (let n = 0; n < 20; n++) driver.step(0.03);
  expect(values.get('ParamMouthOpenY')).toBeGreaterThan(0.1);
  expect(values.get('ParamAngleX')).not.toBe(0);
  expect(values.get('ParamEyeBallX')).not.toBe(0);
  expect([...values.keys()].some((id) => /Hair|Physics/.test(id))).toBe(false);
  driver.setInput({ active: false });
  const count = vi.mocked(player.update).mock.calls.length;
  driver.step(0.03);
  expect(player.update).toHaveBeenCalledTimes(count);
});
it('separates thinking, happy, shy, sleepy and reduced motion poses', () => {
  expect(pose('thinking', 1).headZ).toBeLessThan(0);
  expect(pose('happy', 1).smile).toBeGreaterThan(0.4);
  expect(pose('shy', 1).eyeY).toBeLessThan(0);
  expect(pose('sleepy', 1).eyeOpen).toBeLessThan(0.3);
  expect(pose('idle', 1, 0.5, true).body).toBe(0);
});
it('rejects arbitrary files and unsupported mesh versions', () => {
  expect(() => validateP2lrt(new Uint8Array(32))).toThrow('PSD2Live');
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode('P2LRT'));
  new DataView(bytes.buffer).setUint32(8, 2, true);
  expect(() => validateP2lrt(bytes)).toThrow('目录');
  new DataView(bytes.buffer).setUint32(8, 99, true);
  expect(() => validateP2lrt(bytes)).toThrow('版本');
});
it('runs finite eating and wave actions, then returns arms to rest without changing chat state', () => {
  const values = new Map<string, number>();
  const player: MeshPlayer = {
    parameterRanges: () =>
      ['ParamArmLA', 'ParamArmLB', 'ParamArmRA', 'ParamArmRB', 'ParamMouthOpenY'].map((id) => ({
        id,
        min: -180,
        max: 180,
        default: 0,
      })),
    setParameter: (id, v) => values.set(id, v),
    behaviors: () => {},
    update: () => {},
    draw: () => {},
  };
  const d = createDriver(player, () => 0.5);
  d.setInput({ motionProfile: 'interactive' });
  expect(d.play('eat')).toBe(true);
  for (let i = 0; i < 20; i++) d.step(0.05);
  expect(values.get('ParamArmLB')).toBeGreaterThan(60);
  expect(values.get('ParamMouthOpenY')).toBeGreaterThan(0);
  expect(d.action()?.kind).toBe('eat');
  for (let i = 0; i < 170; i++) d.step(0.05);
  expect(d.action()).toBeUndefined();
  expect(Math.abs(values.get('ParamArmLB')!)).toBeLessThan(0.1);
  d.play('wave');
  d.setInput({ state: 'thinking' });
  d.step(0.05);
  expect(d.action()).toBeUndefined();
  expect(d.play('eat')).toBe(false);
});
it('follows touch gaze and clears a held interaction on backgrounding', () => {
  const values = new Map<string, number>();
  const player: MeshPlayer = {
    parameterRanges: () =>
      ['ParamAngleX', 'ParamAngleY', 'ParamEyeBallX', 'ParamEyeBallY'].map((id) => ({
        id,
        min: -30,
        max: 30,
        default: 0,
      })),
    setParameter: (id, v) => values.set(id, v),
    behaviors: () => {},
    update: () => {},
    draw: () => {},
  };
  const d = createDriver(player);
  d.point(1, 1, true);
  d.step(0.03);
  expect(values.get('ParamAngleX')).toBe(2.5);
  expect(values.get('ParamEyeBallX')).toBe(0.36);
  expect(values.get('ParamAngleY')).toBe(1.5);
  expect(values.get('ParamEyeBallY')).toBe(0.28);
  d.play('pat');
  d.setInput({ active: false });
  expect(d.action()).toBeUndefined();
  d.setInput({ active: true });
  d.step(0.03);
  expect(values.get('ParamAngleX')).not.toBe(2.5);
});

it('offers a bounded one-arm wave for models with a shoulder and elbow in the default profile', () => {
  const values = new Map<string, number>();
  const d = createDriver({
    parameterRanges: () =>
      ['ParamArmLA', 'ParamArmRA', 'ParamArmRB'].map((id) => ({
        id,
        min: -180,
        max: 180,
        default: 0,
      })),
    setParameter: (id, value) => values.set(id, value),
    behaviors: () => {},
    update: () => {},
    draw: () => {},
  });
  expect(d.play('wave')).toBe(true);
  for (let frame = 0; frame < 20; frame++) d.step(0.04);
  expect(values.get('ParamArmLA')).toBe(0);
  expect(values.get('ParamArmRA')).toBeGreaterThan(10);
  expect(values.get('ParamArmRB')).toBeGreaterThan(10);
  expect(values.get('ParamArmRB')).toBeLessThanOrEqual(33);
  expect(d.supports('eat')).toBe(false);
  for (let frame = 0; frame < 100; frame++) d.step(0.04);
  expect(Math.abs(values.get('ParamArmRA')!)).toBeLessThan(0.01);
});

it('keeps default motion small, reserves large arm actions and closes eyelids smoothly', () => {
  for (const state of ['idle', 'thinking', 'talking', 'happy'] as const)
    for (let t = 0; t < 20; t += 0.1) {
      const p = pose(state, t);
      expect(Math.abs(p.headX)).toBeLessThanOrEqual(2.3);
      expect(Math.abs(p.headZ)).toBeLessThanOrEqual(0.7);
      expect(Math.abs(p.body)).toBeLessThanOrEqual(0.5);
    }
  const eyes: number[] = [];
  const d = createDriver(
    {
      parameterRanges: () => [{ id: 'ParamEyeLOpen', min: 0, max: 1, default: 1 }],
      setParameter: (_, value) => eyes.push(value),
      behaviors: () => {},
      update: () => {},
      draw: () => {},
    },
    () => 0,
  );
  expect(d.supports('eat')).toBe(false);
  expect(d.play('stretch')).toBe(false);
  for (let i = 0; i < 170; i++) d.step(1 / 60);
  expect(Math.min(...eyes)).toBeLessThan(0.05);
  expect(eyes.some((v) => v > 0.15 && v < 0.85)).toBe(true);
  expect(Math.max(...eyes.slice(1).map((v, i) => Math.abs(v - eyes[i])))).toBeLessThan(0.35);
});

it('begins mouth motion at speech onset and gives the lips time to close between phrases', () => {
  expect(pose('talking', 0, 0.5, false, 0).mouth).toBe(0);
  expect(pose('talking', 20, 0.5, false, 0.09).mouth).toBe(0.24);
  expect(pose('talking', 20, 0.5, false, 0.32).mouth).toBe(0.36);
  expect(pose('talking', 20, 0.5, false, 0.88).mouth).toBe(0);
  expect(pose('talking', 20, 0.5, false, 1.72).mouth).toBe(0);
  expect(pose('happy', 20).mouth).toBe(0);
  expect(pose('happy', 20, 0.9).smile).toBeGreaterThan(pose('happy', 20, 0.2).smile);
  expect(pose('happy', 20).eyeOpen).toBeGreaterThan(0.9);
  expect(pose('thinking', 20).browL).toBeGreaterThan(pose('thinking', 20).browR);
  expect(pose('idle', 20).browL).toBe(0);
});

it('does not stack a scheduled blink on top of a wink or a sleepy expression', () => {
  const eyes = ['ParamEyeLOpen', 'ParamEyeROpen'];
  const values = new Map<string, number>();
  const driver = createDriver(
    {
      parameterRanges: () => eyes.map((id) => ({ id, min: 0, max: 1, default: 1 })),
      setParameter: (id, value) => values.set(id, value),
      behaviors: () => {},
      update: () => {},
      draw: () => {},
    },
    () => 0,
  );
  for (let i = 0; i < 32; i++) driver.step(0.05);
  expect(driver.play('wink')).toBe(true);
  for (let i = 0; i < 10; i++) driver.step(0.05);
  expect(values.get('ParamEyeLOpen')).toBeLessThan(0.15);
  expect(values.get('ParamEyeROpen')).toBe(1);
  driver.cancelAction();
  driver.setInput({ state: 'sleepy' });
  for (let i = 0; i < 130; i++) driver.step(0.05);
  expect(values.get('ParamEyeLOpen')).toBeCloseTo(0.09);
  expect(values.get('ParamEyeROpen')).toBeCloseTo(0.09);
});

it('enables only actions backed by movable parameters and plays bounded small gestures', () => {
  const values = new Map<string, number>();
  const ids = ['ParamAngleX', 'ParamAngleY', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthForm'];
  const d = createDriver(
    {
      parameterRanges: () =>
        ids.map((id) => ({
          id,
          min: id.includes('Eye') ? 0 : -30,
          max: id.includes('Eye') ? 1 : 30,
          default: id.includes('Eye') ? 1 : 0,
        })),
      setParameter: (id, v) => values.set(id, v),
      behaviors: () => {},
      update: () => {},
      draw: () => {},
    },
    () => 0.5,
  );
  for (const action of ['nod', 'shake', 'wink', 'smile'] as const) {
    expect(d.supports(action)).toBe(true);
    expect(d.play(action)).toBe(true);
    const eyes: number[] = [];
    for (let i = 0; i < 60; i++) {
      d.step(0.05);
      eyes.push(values.get('ParamEyeLOpen')!);
      expect(Math.abs(values.get('ParamAngleX')!)).toBeLessThanOrEqual(3);
    }
    if (action === 'wink') expect(Math.min(...eyes)).toBeLessThan(0.2);
    expect(d.action()).toBeUndefined();
  }
  const empty = createDriver({
    parameterRanges: () => [],
    setParameter: () => {},
    behaviors: () => {},
    update: () => {},
    draw: () => {},
  });
  expect(empty.supports('wink')).toBe(false);
  expect(empty.play('nod')).toBe(false);
});
