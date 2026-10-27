import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resize } = require('../scripts/vtuber/psd.cjs');
const {
  underlap,
  alphaAt,
  scalpUnderpaint,
  weldOutfit,
  prepareComplete,
} = require('../scripts/vtuber/occlusion.cjs');
function rectangle(left: number, top: number, width: number, height: number, color: number[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(color, i);
  return { left, top, png: { width, height, data } };
}
it('resamples translucent edges without leaking transparent white matte into dark outlines', () => {
  const p = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([30, 20, 40, 255, 255, 255, 255, 0]),
  };
  const q = resize(p, 4, 1);
  expect(q.data[7]).toBeGreaterThan(0);
  expect(Array.from(q.data.subarray(4, 7))).toEqual([30, 20, 40]);
  expect(Array.from(q.data.subarray(8, 11))).toEqual([30, 20, 40]);
});
it('adds opaque underlap only inside an occluding cover and preserves the exterior silhouette', () => {
  const part = rectangle(10, 10, 4, 4, [170, 140, 200, 255]);
  const cover = rectangle(13, 9, 4, 6, [250, 200, 200, 255]);
  const expanded = underlap(part, [cover], 3);
  expect(alphaAt(expanded, 15, 11)).toBe(255);
  expect(alphaAt(expanded, 8, 11)).toBe(0);
  expect(alphaAt(expanded, 11, 11)).toBe(255);
  expect(part.png.width).toBe(4);
});
it('fills a hidden scalp cap while retaining visible face pixels and uncovered background', () => {
  const face = rectangle(10, 20, 20, 20, [240, 210, 190, 255]);
  const cap = scalpUnderpaint(face, rectangle(12, 10, 16, 15, [200, 200, 240, 255]));
  expect(alphaAt(cap, 20, 15)).toBe(255);
  expect(alphaAt(cap, 10, 15)).toBe(0);
  const at = ((30 - cap.top) * cap.png.width + 20 - cap.left) * 4;
  expect(Array.from(cap.png.data.subarray(at, at + 4))).toEqual([240, 210, 190, 255]);
});
it('welds clothed sleeve rest poses behind the complete garment without duplicate foreground patches', () => {
  const body = rectangle(10, 10, 10, 20, [240, 180, 210, 255]);
  const arm = rectangle(6, 16, 10, 5, [20, 20, 30, 255]);
  const welded = weldOutfit(body, [arm]);
  expect(alphaAt(welded, 7, 18)).toBe(255);
  const at = ((18 - welded.top) * welded.png.width + 12 - welded.left) * 4;
  expect(Array.from(welded.png.data.subarray(at, at + 4))).toEqual([240, 180, 210, 255]);
});
it('rejects incomplete hidden-area inputs instead of silently compiling a visible-only cutout', () => {
  expect(() => prepareComplete([])).toThrow('Hidden-area input missing');
});
