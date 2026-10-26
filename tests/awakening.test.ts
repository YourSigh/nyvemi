import { it, expect } from 'vitest';
import { awakeningAt, awakeningDuration } from '../src/appearance/awakening';
import { mockRig } from '../src/appearance/mock';
import { validateRig } from '../src/appearance/model';
it('wakes with closed eyes, opens, blinks, moves and finishes in sequence', () => {
  expect(awakeningAt(0).eyesClosed).toBe(true);
  expect(awakeningAt(1500).eyesClosed).toBe(false);
  expect(awakeningAt(2150).eyesClosed).toBe(true);
  expect(awakeningAt(2400).eyesClosed).toBe(false);
  expect(awakeningAt(3100).state).toBe('happy');
  expect(awakeningAt(awakeningDuration).complete).toBe(true);
});
it('keeps eyes and mouth in independent facial bounds for blink and speech', () => {
  const rig = validateRig(mockRig('test'));
  for (const role of ['eyes', 'mouth']) {
    const layer = rig.layers.find((l) => l.role === role)!;
    expect(layer.bounds[2]).toBeLessThan(0.5);
    expect(layer.bounds[3]).toBeLessThan(0.2);
    expect(layer.asset.svg).toContain('viewBox=');
  }
});
