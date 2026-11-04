import type { CharacterRig } from './model';
export type RigLayer = CharacterRig['layers'][number];
export interface ArmRegion {
  crop: number[];
  pivot: number[];
}
export interface RenderLayer {
  layer: RigLayer;
  crop: [number, number, number, number];
  pivot?: [number, number];
  side?: 'left' | 'right';
}
const full: [number, number, number, number] = [0, 0, 1, 1];
/** Resolve in canvas coordinates. A combined/opaque or ambiguous arm stays still. */
export function armLayout(layer: RigLayer, regions: ArmRegion[]): RenderLayer[] {
  const valid = regions.filter(
    ({ crop, pivot }) =>
      crop.length === 4 &&
      pivot.length === 2 &&
      [...crop, ...pivot].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
      crop[2] > 0 &&
      crop[3] > 0 &&
      crop[0] + crop[2] <= 1.001 &&
      crop[1] + crop[3] <= 1.001 &&
      pivot[0] >= crop[0] &&
      pivot[0] <= crop[0] + crop[2] &&
      pivot[1] >= crop[1] &&
      pivot[1] <= crop[1] + crop[3],
  );
  const [x, , w] = layer.bounds;
  if (!valid.length || valid.length !== regions.length || valid.length > 2)
    return [{ layer, crop: full }];
  const sides = valid.map((r) =>
    x + r.pivot[0] * w < 0.5 ? ('left' as const) : ('right' as const),
  );
  if (
    (valid.length === 2 && sides[0] === sides[1]) ||
    (valid.length === 1 && x < 0.5 && x + w > 0.5 && w > 0.4)
  )
    return [{ layer, crop: full }];
  return valid.map((region, i) => {
    const [cx, cy, cw, ch] = region.crop;
    return {
      layer: {
        ...layer,
        bounds: [x + cx * w, layer.bounds[1] + cy * layer.bounds[3], cw * w, ch * layer.bounds[3]],
      },
      crop: [cx, cy, cw, ch],
      pivot: [(region.pivot[0] - cx) / cw, (region.pivot[1] - cy) / ch],
      side: sides[i],
    };
  });
}
