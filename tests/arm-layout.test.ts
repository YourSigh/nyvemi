import { expect, it } from 'vitest';
import { armLayout, type RigLayer } from '../src/appearance/arm-layout';
const layer: RigLayer = {
  role: 'arm',
  z: 2,
  asset: { uri: 'file://arms', width: 1000, height: 500 },
  bounds: [0.2, 0.4, 0.6, 0.3],
};
it('separates legacy arm pixels without changing their neutral positions and anchors each shoulder', () => {
  const result = armLayout(layer, [
    { crop: [0, 0, 0.5, 1], pivot: [0.1, 0.1] },
    { crop: [0.5, 0, 0.5, 1], pivot: [0.9, 0.2] },
  ]);
  expect(result.map((p) => p.side)).toEqual(['left', 'right']);
  expect(result[0].layer.bounds).toEqual([0.2, 0.4, 0.3, 0.3]);
  expect(result[1].layer.bounds).toEqual([0.5, 0.4, 0.3, 0.3]);
  expect(result[0].pivot).toEqual([0.2, 0.1]);
  expect(result[1].pivot).toEqual([0.8, 0.2]);
});
it('uses a single arm shoulder as its pivot and holds ambiguous combined artwork still', () => {
  expect(
    armLayout({ ...layer, bounds: [0.6, 0.4, 0.2, 0.3] }, [
      { crop: [0, 0, 1, 1], pivot: [0.2, 0.1] },
    ])[0].side,
  ).toBe('right');
  expect(armLayout(layer, [{ crop: [0, 0, 1, 1], pivot: [0.2, 0.1] }])[0].side).toBeUndefined();
  expect(armLayout(layer, [{ crop: [0, 0, 0.5, 1], pivot: [1.2, 0.1] }])[0].side).toBeUndefined();
});
