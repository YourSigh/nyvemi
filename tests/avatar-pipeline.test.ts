import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const { prepare } = require('../scripts/vtuber/prepare.cjs');
const { convert } = require('../scripts/vtuber/psd.cjs');
it('prepares generic green eyes, independent ponytails and a round-trippable layered PSD without any AI request', () => {
  const root = mkdtempSync(join(tmpdir(), 'nyvemi-mesh-test-'));
  try {
    const items: [string, number[], (x: number, y: number) => number[]][] = [
      ['body', [48, 96, 80, 145], () => [30, 30, 40, 255]],
      ['arm', [32, 100, 96, 120], () => [240, 210, 190, 255]],
      ['head', [32, 32, 96, 96], () => [255, 230, 220, 255]],
      [
        'eyes',
        [32, 48, 96, 66],
        (x, y) =>
          (x - 18) ** 2 / 36 + (y - 9) ** 2 / 49 < 1 || (x - 46) ** 2 / 36 + (y - 9) ** 2 / 49 < 1
            ? [40, 180, 60, 255]
            : [0, 0, 0, 0],
      ],
      ['mouth', [60, 78, 68, 84], () => [80, 30, 40, 255]],
      [
        'hair',
        [8, 8, 120, 110],
        (x, y) => (y < 24 || x < 20 || x > 92 ? [240, 240, 245, 255] : [0, 0, 0, 0]),
      ],
    ];
    const layers = items.map(([name, box, pixel], i) => {
      const [l, t, r, b] = box;
      const p = new PNG({ width: r - l, height: b - t });
      for (let y = 0; y < p.height; y++)
        for (let x = 0; x < p.width; x++) p.data.set(pixel(x, y), (y * p.width + x) * 4);
      const file = `${i}.png`;
      writeFileSync(join(root, file), PNG.sync.write(p));
      return { name, file, z_index: i, bounding_box: { absolute: box } };
    });
    const source = join(root, 'layers.json'),
      out = join(root, 'prepared/layers.json');
    writeFileSync(source, JSON.stringify({ size: '160x160', layers }));
    mkdirSync(join(root, 'prepared'));
    const prepared = prepare(source, out);
    expect(prepared.layers.map((l: { name: string }) => l.name)).toContain('back hair left');
    expect(prepared.layers.map((l: { name: string }) => l.name)).toContain('back hair right');
    // A coarse input cannot isolate the ornament. Never cut a rectangular
    // headwear hole, and retain opaque coverage through all hair joins.
    expect(prepared.layers.some((l: { name: string }) => l.name === 'headwear')).toBe(false);
    const hairLayers = prepared.layers
      .filter((l: { name: string }) => /hair/.test(l.name))
      .map((l: { file: string; bounding_box: { absolute: number[] } }) => ({
        box: l.bounding_box.absolute,
        png: PNG.sync.read(readFileSync(join(root, 'prepared', l.file))),
      }));
    let overlap = 0;
    const sourceHair = PNG.sync.read(readFileSync(join(root, '5.png')));
    for (let y = 0; y < sourceHair.height; y++)
      for (let x = 0; x < sourceHair.width; x++) {
        const original = sourceHair.data[(y * sourceHair.width + x) * 4 + 3];
        if (original < 250) continue;
        const alphas = hairLayers.map(
          ({ box, png }: { box: number[]; png: { width: number; data: Uint8Array } }) => {
            const px = x + 8 - box[0],
              py = y + 8 - box[1];
            return px >= 0 && py >= 0 && x + 8 < box[2] && y + 8 < box[3]
              ? png.data[(py * png.width + px) * 4 + 3] / 255
              : 0;
          },
        );
        expect(
          1 - alphas.reduce((remaining: number, a: number) => remaining * (1 - a), 1),
        ).toBeGreaterThan(0.98);
        if (alphas.filter((a: number) => a > 0.2).length >= 2) overlap++;
      }
    expect(overlap).toBeGreaterThan(50);
    const iris = prepared.layers.find((l: { name: string }) => l.name === 'irides left');
    expect(iris).toBeDefined();
    const p = PNG.sync.read(readFileSync(join(root, 'prepared', iris.file)));
    let green = 0;
    for (let i = 0; i < p.data.length; i += 4)
      if (p.data[i + 3] > 200) {
        expect(p.data[i + 1]).toBeGreaterThan(p.data[i]);
        green++;
      }
    expect(green).toBeGreaterThan(10);
    const psd = join(root, 'avatar.psd');
    convert(out, psd);
    expect(readFileSync(psd).subarray(0, 4).toString()).toBe('8BPS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
