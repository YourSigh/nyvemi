import { expect, it } from 'vitest';
import { hasCharacterVisual } from '../src/character/visual';
import { mockRig } from '../src/appearance/mock';
it('hides missing and saved default Mock characters while keeping actual user visuals', () => {
  const rig = mockRig('default');
  expect(hasCharacterVisual(undefined)).toBe(false);
  expect(hasCharacterVisual({ rig })).toBe(false);
  expect(hasCharacterVisual({ rig }, true)).toBe(true);
  expect(hasCharacterVisual({ rig: { ...rig, source: 'seedream' } })).toBe(true);
  expect(
    hasCharacterVisual({
      rig,
      meshAvatar: { format: 'p2lrt', version: 1, uri: 'file://real.p2lrt' },
    }),
  ).toBe(true);
});
