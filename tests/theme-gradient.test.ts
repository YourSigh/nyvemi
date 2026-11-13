import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { ThemeGradient } from '../src/ui/theme-gradient';

vi.mock('react-native', () => ({ StyleSheet: { absoluteFill: {} } }));
vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Defs: 'Defs',
  LinearGradient: 'LinearGradient',
  Rect: 'Rect',
  Stop: 'Stop',
}));

it('draws the saved background stops diagonally without intercepting gestures', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(createElement(ThemeGradient, { stops: ['#E9F4FF', '#EFE7FF'] }));
    });
    expect(renderer!.root.findByType('LinearGradient' as never).props).toMatchObject({
      x1: '0%',
      y1: '0%',
      x2: '100%',
      y2: '100%',
    });
    expect(
      renderer!.root.findAllByType('Stop' as never).map((stop) => stop.props.stopColor),
    ).toEqual(['#E9F4FF', '#EFE7FF']);
    expect(renderer!.root.findByType('Svg' as never).props.pointerEvents).toBe('none');
    await act(async () => renderer!.update(createElement(ThemeGradient, { stops: undefined })));
    expect(renderer!.toJSON()).toBeNull();
  } finally {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
