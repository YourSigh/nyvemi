import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { styles, writeFixture } = require('./fixtures/avatar-materials.cjs');
const { prepare } = require('../scripts/vtuber/prepare.cjs');
const { convert } = require('../scripts/vtuber/psd.cjs');
const { validateManifest } = require('../scripts/vtuber/material.cjs');
const { rigPortrait, completeLayers } = require('../scripts/vtuber/prompts.cjs');
const { PNG } = require('pngjs');
interface Style {
  id: string;
  hair: string;
  eye: number[];
  color: number[];
  skin: number[];
  arms: boolean;
}
for (const style of styles as Style[])
  it(`prepares ${style.id} with its own palette and actual hair topology`, () => {
    const root = mkdtempSync(join(tmpdir(), 'nyvemi-generic-'));
    try {
      const source = writeFixture(root, style),
        output = join(root, 'prepared/layers.json');
      const prepared = prepare(source, output);
      const names = prepared.layers.map((l: { name: string }) => l.name);
      expect(names.includes('front hair')).toBe(style.hair !== 'none');
      expect(names.includes('back hair')).toBe(style.hair === 'long');
      expect(names.includes('back hair left')).toBe(style.hair === 'twin');
      const iris = prepared.layers.find((l: { name: string }) => l.name === 'irides left');
      const png = PNG.sync.read(readFileSync(join(root, 'prepared', iris.file)));
      const colors = [];
      for (let i = 0; i < png.data.length; i += 4)
        if (png.data[i + 3] > 240) colors.push(Array.from(png.data.subarray(i, i + 3)));
      expect(colors).toContainEqual(style.eye);
      const report = JSON.parse(readFileSync(join(root, 'prepared/occlusion-report.json'), 'utf8'));
      expect(report.joints.every((j: { pixels: number }) => j.pixels >= report.minimum)).toBe(true);
      convert(output, join(root, 'fixture.psd'));
      expect(readFileSync(join(root, 'fixture.psd')).subarray(0, 4).toString()).toBe('8BPS');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
it('does not impose Tongza identity or twin tails in generic prompts', () => {
  expect(rigPortrait).not.toMatch(
    /silver-white|purple eyes|bucket-shaped|pink white black|rounded twin tails/i,
  );
  expect(completeLayers).toContain('only if present');
  expect(completeLayers).not.toContain('bucket ornament');
});
it('rejects malformed, duplicate or disconnected input rather than silently substituting a stock model', () => {
  expect(() => validateManifest({ size: '99999x99999', layers: [] })).toThrow('canvas');
  const root = mkdtempSync(join(tmpdir(), 'nyvemi-bad-material-'));
  try {
    const file = writeFixture(root, styles[0]),
      source = JSON.parse(readFileSync(file, 'utf8'));
    expect(() =>
      validateManifest({ ...source, layers: [...source.layers, source.layers[0]] }),
    ).toThrow('Duplicate');
    const neck = source.layers.find((l: { name: string }) => l.name === 'Neck');
    neck.bounding_box.absolute = [0, 340, 25, 377];
    writeFileSync(file, JSON.stringify(source));
    expect(() => prepare(file, join(root, 'bad/layers.json'))).toThrow('Disconnected');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
