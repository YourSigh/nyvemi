import { expect, it } from 'vitest';
import { remainingPolygon } from '../src/theme/reveal';
function points(progress: number) {
  return remainingPolygon(360, 800, progress)
    .split(' ')
    .map((pair) => pair.split(',').map(Number));
}
function area(vertices: number[][]) {
  return (
    Math.abs(
      vertices.reduce((sum, a, n) => {
        const b = vertices[(n + 1) % vertices.length];
        return sum + a[0] * b[1] - a[1] * b[0];
      }, 0),
    ) / 2
  );
}
it('reveals the new theme diagonally while the old theme contracts toward bottom-right', () => {
  expect(area(points(0))).toBe(360 * 800);
  let previous = Infinity;
  for (let n = 0; n <= 100; n++) {
    const progress = n / 100;
    const vertices = points(progress);
    for (const [x, y] of vertices) {
      expect(x).toBeGreaterThanOrEqual(-0.00001);
      expect(x).toBeLessThanOrEqual(360.00001);
      expect(y).toBeGreaterThanOrEqual(-0.00001);
      expect(y).toBeLessThanOrEqual(800.00001);
      expect(x + y + 0.00001).toBeGreaterThanOrEqual(progress * 1160);
    }
    const remaining = area(vertices);
    expect(remaining).toBeLessThanOrEqual(previous + 0.00001);
    previous = remaining;
  }
  expect(area(points(1))).toBe(0);
  expect(points(-10)).toEqual(points(0));
  expect(points(10)).toEqual(points(1));
});
it('does not assume a square screen', () => {
  for (const [w, h] of [
    [1000, 240],
    [1, 1],
    [412, 915],
  ]) {
    const start = remainingPolygon(w, h, 0)
      .split(' ')
      .map((p) => p.split(',').map(Number));
    const end = remainingPolygon(w, h, 1)
      .split(' ')
      .map((p) => p.split(',').map(Number));
    expect(area(start)).toBe(w * h);
    expect(area(end)).toBe(0);
  }
});
