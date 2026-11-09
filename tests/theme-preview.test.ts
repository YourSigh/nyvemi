import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemePreviewScreen } from '../src/ui/theme-preview';
import { visualThemePalette } from '../src/theme/visual-presets';
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Keyboard: { dismiss: vi.fn() },
  useWindowDimensions: () => ({ width: 384, height: 850 }),
}));
vi.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: 'KeyboardAvoidingView',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('../src/ui/character/cocoon', () => ({ CocoonCharacter: 'CocoonCharacter' }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
let screen: ReactTestRenderer | undefined;
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
});
it('previews four local themes without RuntimeContext, offering only the other three as suggestions', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    screen = create(
      createElement(ThemePreviewScreen, {
        navigation: { goBack: vi.fn() },
        route: { params: undefined },
      } as unknown as Parameters<typeof ThemePreviewScreen>[0]),
    );
  });
  const labels = () =>
    screen!.root
      .findAll((node) => String(node.type) === 'Pressable')
      .map((node) => node.props.accessibilityLabel);
  expect(labels()).toContain('Sakura Mist');
  expect(labels()).toContain('Moonlight');
  expect(labels()).not.toContain('预览Sakura Mist');
  expect(labels().filter((label: string) => label?.startsWith('预览'))).toHaveLength(3);
  await act(async () =>
    screen!.root
      .find(
        (node) =>
          String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Moonlight',
      )
      .props.onPress(),
  );
  expect(labels()).toContain('预览Sakura Mist');
  expect(labels()).not.toContain('预览Moonlight');
  expect(
    screen!.root.find((node) => String(node.type) === 'SafeAreaView').props.style.backgroundColor,
  ).toBe(visualThemePalette('moonlight').background);
  expect(labels()).not.toContain('对比旧设计');
});
it('opens a requested preview directly and falls back safely for unknown names', async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    screen = create(
      createElement(ThemePreviewScreen, {
        navigation: { goBack: vi.fn() },
        route: { params: { preset: 'nebula' } },
      } as unknown as Parameters<typeof ThemePreviewScreen>[0]),
    );
  });
  expect(
    screen!.root.find((node) => String(node.type) === 'SafeAreaView').props.style.backgroundColor,
  ).toBe(visualThemePalette('nebula').background);
  expect(screen!.root.findAll((node) => String(node.type) === 'CocoonCharacter')).toHaveLength(1);
  await act(async () =>
    screen!.update(
      createElement(ThemePreviewScreen, {
        key: 'unknown',
        navigation: { goBack: vi.fn() },
        route: { params: { preset: 'unknown' } },
      } as unknown as Parameters<typeof ThemePreviewScreen>[0]),
    ),
  );
  expect(
    screen!.root.find((node) => String(node.type) === 'SafeAreaView').props.style.backgroundColor,
  ).toBe(visualThemePalette('sakura').background);
});
