import type { CharacterRig, ImageAsset } from './model';
// Original, deterministic test art. No network, no paid request, no character-specific assets.
export function mockRig(seed: string): CharacterRig {
  let hash = 0;
  for (const c of seed) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const color = `hsl(${hash % 360},55%,77%)`;
  const ink = '#534358';
  const layer = (role: CharacterRig['layers'][number]['role'], shape: string, z: number) => ({
    role,
    z,
    bounds: [0, 0, 1, 1] as [number, number, number, number],
    asset: {
      uri: `mock:${hash}:${role}`,
      width: 240,
      height: 340,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340" viewBox="0 0 240 340">${shape}</svg>`,
    },
  });
  return {
    version: 1,
    source: 'mock',
    width: 240,
    height: 340,
    layers: [
      layer(
        'body',
        `<path fill="${color}" stroke="${ink}" stroke-width="3" d="M82 185 Q120 170 158 185 L178 277 Q120 296 62 277Z"/><path fill="#fff4ef" stroke="${ink}" stroke-width="3" d="M88 279V321H108V282M132 282V321H152V279"/><ellipse cx="96" cy="325" rx="17" ry="8" fill="${ink}"/><ellipse cx="145" cy="325" rx="17" ry="8" fill="${ink}"/>`,
        1,
      ),
      layer(
        'hair',
        `<ellipse cx="120" cy="111" rx="88" ry="97" fill="${color}" stroke="${ink}" stroke-width="3"/><path d="M40 110Q0 180 35 250Q62 225 65 150M196 110Q240 180 209 250Q180 225 178 150" fill="${color}" stroke="${ink}" stroke-width="3"/>`,
        2,
      ),
      layer(
        'head',
        `<ellipse cx="120" cy="118" rx="66" ry="69" fill="#fff0e8" stroke="${ink}" stroke-width="3"/><path d="M52 103Q48 24 125 26Q193 26 188 105L157 66L146 93L117 64L91 99L81 75Z" fill="${color}" stroke="${ink}" stroke-width="3"/><ellipse cx="77" cy="143" rx="13" ry="6" fill="#f5b7c5"/><ellipse cx="163" cy="143" rx="13" ry="6" fill="#f5b7c5"/>`,
        3,
      ),
      layer(
        'arm',
        `<path d="M77 194Q44 194 52 242Q59 251 68 237L83 210" fill="#fff0e8" stroke="${ink}" stroke-width="3"/><path d="M160 197Q191 177 187 157Q174 147 174 168L150 190" fill="#fff0e8" stroke="${ink}" stroke-width="3"/>`,
        4,
      ),
      layer(
        'eyes',
        `<ellipse cx="91" cy="120" rx="10" ry="15" fill="${ink}"/><ellipse cx="150" cy="120" rx="10" ry="15" fill="${ink}"/><circle cx="94" cy="115" r="4" fill="#fff"/><circle cx="153" cy="115" r="4" fill="#fff"/>`,
        5,
      ),
      layer(
        'mouth',
        `<path d="M109 151Q120 163 132 151Q120 179 109 151Z" fill="#d887a4" stroke="${ink}" stroke-width="2"/>`,
        6,
      ),
    ],
  };
}
export function mockCandidate(seed: string): ImageAsset {
  const rig = mockRig(seed);
  const shapes = rig.layers
    .map((l) => l.asset.svg!.replace(/^.*?<svg[^>]*>/, '').replace(/<\/svg>$/, ''))
    .join('');
  return {
    uri: `mock:preview:${seed}`,
    width: 240,
    height: 340,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340" viewBox="0 0 240 340">${shapes}</svg>`,
  };
}
