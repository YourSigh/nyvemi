import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { RigCharacter } from '../src/ui/character/rig';
import type { CharacterRig } from '../src/appearance/model';
const analyze = vi.hoisted(() => vi.fn());
vi.mock('../src/native/android', () => ({ bridge: () => ({ analyzeCharacterImage: analyze }) }));
vi.mock('react-native', () => ({
  Animated: { View: 'AnimatedView' },
  Image: 'Image',
  View: 'View',
}));
vi.mock('react-native-svg', () => ({ SvgXml: 'SvgXml' }));
const rig: CharacterRig = {
  version: 1,
  source: 'seedream',
  width: 1000,
  height: 1000,
  layers: [
    {
      role: 'arm',
      z: 2,
      asset: { uri: 'file://combined', width: 600, height: 300 },
      bounds: [0.2, 0.4, 0.6, 0.3],
    },
  ],
};
it('renders independent shoulder pivots and never passes an undefined transformOrigin to RN', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  analyze.mockResolvedValue([
    { crop: [0, 0, 0.5, 1], pivot: [0.1, 0.1] },
    { crop: [0.5, 0, 0.5, 1], pivot: [0.9, 0.2] },
  ]);
  let view!: ReactTestRenderer;
  const left = { transform: [{ rotate: '0deg' }] },
    right = { transform: [{ rotate: '-28deg' }] };
  await act(async () => {
    view = create(
      createElement(RigCharacter, {
        rig,
        width: 500,
        height: 500,
        eyesClosed: false,
        mouthOpen: false,
        state: 'idle',
        headStyle: {},
        leftArmStyle: left,
        armStyle: right,
      }),
    );
  });
  const arms = view.root.findAllByType('AnimatedView' as never);
  expect(arms).toHaveLength(2);
  expect(arms[0].props.style[1]).toEqual(left);
  expect(arms[1].props.style[1]).toEqual(right);
  expect(arms[0].props.style[0].left + arms[0].props.style[0].transformOrigin[0]).toBeCloseTo(130);
  expect(arms[1].props.style[0].left + arms[1].props.style[0].transformOrigin[0]).toBeCloseTo(370);
  await act(async () => view.unmount());
  analyze.mockRejectedValueOnce(Error('geometry unavailable'));
  await act(async () => {
    view = create(
      createElement(RigCharacter, {
        rig: { ...rig },
        width: 500,
        height: 500,
        eyesClosed: false,
        mouthOpen: false,
        state: 'idle',
        headStyle: {},
        armStyle: right,
      }),
    );
  });
  const fallback = view.root.findByType('AnimatedView' as never);
  expect(fallback.props.style[0]).not.toHaveProperty('transformOrigin');
  expect(fallback.props.style[1]).toBeUndefined();
  await act(async () => view.unmount());
});
