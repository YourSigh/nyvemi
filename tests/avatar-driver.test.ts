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
  expect(pose('happy', 1).smile).toBeGreaterThan(0.5);
  expect(pose('shy', 1).eyeY).toBeLessThan(0);
  expect(pose('sleepy', 1).eyeOpen).toBeLessThan(0.3);
  expect(pose('idle', 1, 0.5, true).body).toBe(0);
});
it('rejects arbitrary files and unsupported mesh versions', () => {
  expect(() => validateP2lrt(new Uint8Array(32))).toThrow('PSD2Live');
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode('P2LRT'));
  new DataView(bytes.buffer).setUint32(8, 2, true);
  expect(() => validateP2lrt(bytes)).not.toThrow();
  new DataView(bytes.buffer).setUint32(8, 99, true);
  expect(() => validateP2lrt(bytes)).toThrow('版本');
});
