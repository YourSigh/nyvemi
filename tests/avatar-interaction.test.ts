import { it, expect } from 'vitest';
import { dragOffset } from '../src/avatar/interactions';
it('bounds dragging so the model cannot be lost and preserves relative position across keyboard resize', () => {
  expect(dragOffset({ x: 0, y: 0 }, 10000, -10000, 360, 220)).toEqual({ x: 0.3, y: -0.18 });
  const offset = dragOffset({ x: 0.1, y: 0 }, 36, 22, 360, 220);
  expect(offset.x).toBeCloseTo(0.2);
  expect(offset.y).toBeCloseTo(0.1);
  expect(offset.y * 110).toBeCloseTo(11); // The same normalized offset fits the smaller keyboard viewport.
  expect(dragOffset({ x: 0, y: 0 }, 20, 20, 0, 0)).toEqual({ x: 0.3, y: 0.18 });
});
