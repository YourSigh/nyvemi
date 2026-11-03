import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Keyboard } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { useTheme, usePalette } from '../src/theme/context';
import { useRuntime } from '../src/ui/context';
import { Page, Field } from '../src/ui/components';
import { ThemeScreen } from '../src/ui/theme';
import { ThemeService } from '../src/theme/service';
import { defaultPalette } from '../src/theme/generator';
import { defaultPreference } from '../src/theme/model';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import type { LLMProvider } from '../src/providers/provider';
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  Keyboard: {
    dismiss: vi.fn(),
    isVisible: () => false,
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));
vi.mock('@react-navigation/native', async () => {
  const { createContext } = await import('react');
  return { NavigationContext: createContext(undefined), usePreventRemove: vi.fn() };
});
vi.mock('@react-navigation/elements', async () => {
  const { createContext } = await import('react');
  return { HeaderShownContext: createContext(true) };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 28, left: 0, right: 0 }),
}));
vi.mock('react-native-keyboard-controller', async () => {
  const { createElement } = await import('react');
  return {
    KeyboardAwareScrollView: 'AwareScrollView',
    KeyboardToolbar: Object.assign(
      (props: { children?: ReactNode }) => createElement('Toolbar', props),
      { Prev: 'Prev', Next: 'Next', Done: 'Done' },
    ),
  };
});
vi.mock('../src/theme/context', () => ({ useTheme: vi.fn(), usePalette: vi.fn() }));
vi.mock('../src/ui/context', () => ({ useRuntime: vi.fn() }));
const apply = vi.fn();
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.mocked(usePalette).mockReturnValue(defaultPalette);
  vi.mocked(useTheme).mockReturnValue({
    palette: defaultPalette,
    transitioning: false,
    reducedMotion: false,
    hydrate: vi.fn(),
    apply,
  });
  apply.mockImplementation(async (_record, persist: () => Promise<void>) => persist());
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
});
async function fixture(provider?: Partial<LLMProvider>) {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const model: LLMProvider = {
    chat: async () => {
      throw Error('unused');
    },
    streamChat: async () => {
      throw Error('unused');
    },
    structuredOutput: async (_messages, schema) =>
      schema.parse({ ...defaultPreference, base: 'blue' }),
    ...provider,
  };
  const themes = new ThemeService(store, async () => model);
  vi.mocked(useRuntime).mockReturnValue({ themes } as ReturnType<typeof useRuntime>);
  return { store, themes };
}
it('settings color edits expose an input, save the theme and leave the opening/character flow untouched', async () => {
  const { themes } = await fixture();
  await themes.rememberOpening('尚未完成的开场偏好');
  const navigation = { replace: vi.fn(), goBack: vi.fn() };
  await act(async () => {
    renderer = create(
      createElement(ThemeScreen, {
        route: { params: { mode: 'settings' } },
        navigation,
      } as never),
    );
  });
  const input = renderer!.root.findByType('TextInput' as never);
  await act(async () => input.props.onChangeText('淡蓝色，安静一点'));
  await act(async () =>
    renderer!.root.findByProps({ accessibilityLabel: '换成这个颜色' }).props.onPress(),
  );
  expect(await themes.load()).toMatchObject({ preference: { base: 'blue' } });
  expect(await themes.opening()).toBe('尚未完成的开场偏好');
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(apply).toHaveBeenCalledOnce();
  expect(renderer!.root.findByType('TextInput' as never).props.editable).toBe(true);
});
it('lets the user cancel a pending settings color request and continue editing', async () => {
  let signal: AbortSignal | undefined;
  const { themes } = await fixture({
    structuredOutput: async (_m, _s, _p, nextSignal) => {
      signal = nextSignal;
      return new Promise(() => {});
    },
  } as LLMProvider);
  await act(async () => {
    renderer = create(
      createElement(ThemeScreen, {
        route: { params: { mode: 'settings' } },
        navigation: { replace: vi.fn() },
      } as never),
    );
  });
  await act(async () =>
    renderer!.root.findByType('TextInput' as never).props.onChangeText('像某个未命名星球的感觉'),
  );
  await act(async () =>
    renderer!.root.findByProps({ accessibilityLabel: '换成这个颜色' }).props.onPress(),
  );
  expect(signal?.aborted).toBe(false);
  await act(async () => renderer!.root.findByProps({ accessibilityLabel: '取消' }).props.onPress());
  expect(signal?.aborted).toBe(true);
  expect(await themes.load()).toBeUndefined();
  expect(apply).not.toHaveBeenCalled();
  expect(renderer!.root.findByType('TextInput' as never).props.editable).toBe(true);
});
it('removes a background form keyboard toolbar and dismisses the keyboard on navigation blur', async () => {
  const listeners: Record<string, () => void> = {};
  const navigation = {
    isFocused: () => true,
    addListener: (name: string, listener: () => void) => {
      listeners[name] = listener;
      return () => {
        delete listeners[name];
      };
    },
  };
  await act(async () => {
    renderer = create(
      createElement(
        NavigationContext.Provider,
        { value: navigation as never },
        createElement(
          Page,
          null,
          createElement(Field, { label: '每天主动开启话题', keyboardType: 'number-pad' }),
        ),
      ),
    );
  });
  expect(renderer!.root.findAllByType('Toolbar' as never)).toHaveLength(1);
  await act(async () => listeners.blur());
  expect(Keyboard.dismiss).toHaveBeenCalledOnce();
  expect(renderer!.root.findAllByType('Toolbar' as never)).toHaveLength(0);
  expect(renderer!.root.findByType('AwareScrollView' as never).props.enabled).toBe(false);
  await act(async () => listeners.focus());
  expect(renderer!.root.findAllByType('Toolbar' as never)).toHaveLength(1);
});
it('only scrolls overflowing pages and still scrolls when the keyboard opens', async () => {
  await act(async () => {
    renderer = create(createElement(Page, null, createElement(Field, { label: '密钥' })));
  });
  const scroll = () => renderer!.root.findByType('AwareScrollView' as never);
  await act(async () => {
    scroll().props.onLayout({ nativeEvent: { layout: { height: 640 } } });
    scroll().props.onContentSizeChange(360, 640);
  });
  expect(scroll().props.scrollEnabled).toBe(false);
  await act(async () => scroll().props.onContentSizeChange(360, 690));
  expect(scroll().props.scrollEnabled).toBe(true);
  await act(async () => scroll().props.onContentSizeChange(360, 640));
  const show = vi
    .mocked(Keyboard.addListener)
    .mock.calls.find(([event]) => event === 'keyboardDidShow')![1];
  const hide = vi
    .mocked(Keyboard.addListener)
    .mock.calls.find(([event]) => event === 'keyboardDidHide')![1];
  await act(async () => show({} as never));
  expect(scroll().props.scrollEnabled).toBe(true);
  await act(async () => hide({} as never));
  expect(scroll().props.scrollEnabled).toBe(false);
});
