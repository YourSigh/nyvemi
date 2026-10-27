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
      ['ParamAngleX', 'ParamEyeBallX'].map((id) => ({ id, min: -30, max: 30, default: 0 })),
    setParameter: (id, v) => values.set(id, v),
    behaviors: () => {},
    update: () => {},
    draw: () => {},
  };
  const d = createDriver(player);
  d.point(1, 0, true);
  d.step(0.03);
  expect(values.get('ParamAngleX')).toBe(2.5);
  expect(values.get('ParamEyeBallX')).toBe(0.8);
  d.play('pat');
  d.setInput({ active: false });
  expect(d.action()).toBeUndefined();
  d.setInput({ active: true });
  d.step(0.03);
  expect(values.get('ParamAngleX')).not.toBe(2.5);
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
