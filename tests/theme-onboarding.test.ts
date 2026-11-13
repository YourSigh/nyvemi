import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WelcomeScreen, ProviderScreen } from '../src/ui/onboarding';
import { ThemeScreen } from '../src/ui/theme';
import { RuntimeContext } from '../src/ui/context';
import type { Runtime } from '../src/application/runtime';
import { ThemeProvider, useTheme } from '../src/theme/context';
import { ThemeService } from '../src/theme/service';
import { defaultPreference } from '../src/theme/model';
import { defaultPalette, generatePalette } from '../src/theme/generator';
import { saveProviderSettings } from '../src/application/provider-settings';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import type { LLMProvider } from '../src/providers/provider';
const native = vi.hoisted(() => ({
  prepareThemeTransition: vi.fn(),
  revealThemeTransition: vi.fn(),
  finishThemeTransition: vi.fn(),
}));
const secrets = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
vi.mock('../src/native/android', () => ({ bridge: () => native }));
vi.mock('../src/storage/native', () => ({ secretStore: secrets }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Circle: 'Circle' }));
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
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => false,
    addEventListener: () => ({ remove: () => {} }),
  },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
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
let current: ReturnType<typeof useTheme>;
function Probe() {
  current = useTheme();
  return null;
}
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  native.prepareThemeTransition.mockResolvedValue(true);
  native.revealThemeTransition.mockImplementation(
    (_id: string, ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  );
  native.finishThemeTransition.mockResolvedValue(undefined);
  secrets.get.mockResolvedValue(null);
  secrets.set.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function fixture() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const modelCall = vi.fn(async () => ({
    ...defaultPreference,
    base: 'purple' as const,
    mood: 'dreamy' as const,
  }));
  const model: LLMProvider = {
    chat: async () => ({ content: 'OK', usage: {} }),
    streamChat: async () => ({ content: '', usage: {} }),
    structuredOutput: async (_messages, schema) => schema.parse(await modelCall()),
  };
  const provider = vi.fn(async () => {
    if (!(await store.get('provider', 'provider'))) throw Error('请先配置Provider');
    return model;
  });
  const themes = new ThemeService(store, provider);
  const runtime = {
    store,
    hatching: { start: vi.fn(async () => ({ id: 'egg-test' })) },
    themes,
    provider,
    saveProvider: (config: Parameters<typeof saveProviderSettings>[2], key: string) =>
      saveProviderSettings(store, secrets, config, key),
  } as unknown as Runtime;
  return { store, themes, runtime, provider, modelCall };
}
const navigation = () => ({ navigate: vi.fn(), replace: vi.fn(), reset: vi.fn() });
function tree(runtime: Runtime, screen: ReactNode) {
  return createElement(
    ThemeProvider,
    null,
    createElement(RuntimeContext.Provider, { value: runtime }, createElement(Probe), screen),
  );
}
async function mountWelcome(runtime: Runtime, nav: ReturnType<typeof navigation>) {
  await act(async () => {
    renderer = create(tree(runtime, createElement(WelcomeScreen, { navigation: nav } as never)));
  });
}
async function enterColor(description: string) {
  await act(async () =>
    renderer!.root
      .findByProps({ accessibilityLabel: '你喜欢的颜色和感觉' })
      .props.onChangeText(description),
  );
  await act(async () =>
    renderer!.root.findByProps({ accessibilityLabel: '就这个感觉' }).props.onPress(),
  );
}
it('applies a blue palette before leaving Welcome without a model/key, preserves it through Provider and restart', async () => {
  const f = await fixture(),
    nav = navigation();
  await mountWelcome(f.runtime, nav);
  expect(current.palette.accent).toBe(defaultPalette.accent);
  await enterColor('淡蓝色，安静一点');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  const selected = await f.themes.load();
  expect(selected).toMatchObject({ source: 'local', preference: { base: 'blue' } });
  expect(current.palette.accent).toBe(generatePalette(selected!.preference).accent);
  expect(current.palette.accent).not.toBe(defaultPalette.accent);
  expect(native.revealThemeTransition).toHaveBeenCalledWith(expect.any(String), 2200);
  expect(nav.navigate).toHaveBeenCalledWith('Provider', { onboarding: true, skipTheme: true });
  expect(f.provider).not.toHaveBeenCalled();
  expect(await f.themes.opening()).toBeUndefined();
  await act(async () => {
    renderer!.update(
      tree(
        f.runtime,
        createElement(ProviderScreen, {
          navigation: nav,
          route: { params: { onboarding: true, skipTheme: true } },
        } as never),
      ),
    );
  });
  await act(async () =>
    renderer!.root
      .findByProps({ accessibilityLabel: 'API Key' })
      .props.onChangeText('test-key-only'),
  );
  await act(async () =>
    renderer!.root.findByProps({ accessibilityLabel: '开始聊天' }).props.onPress(),
  );
  expect(nav.reset).toHaveBeenCalledWith({
    index: 0,
    routes: [{ name: 'Chat', params: { characterId: 'egg-test' } }],
  });
  expect(current.palette.accent).toBe(generatePalette(selected!.preference).accent);
  expect(await f.themes.load()).toEqual(selected);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  await act(async () => {
    renderer = create(tree(f.runtime, null));
  });
  await act(async () => {
    current.hydrate(await f.themes.load());
  });
  expect(current.palette.accent).toBe(generatePalette(selected!.preference).accent);
});
it.each([
  ['紫色，梦幻一点', 'purple'],
  ['薄荷绿，清爽一点', 'mint'],
  ['黑色，暗一点', 'neutral'],
] as const)(
  'applies %s with no provider and does not retain the default accent',
  async (description, base) => {
    const f = await fixture(),
      nav = navigation();
    await mountWelcome(f.runtime, nav);
    await enterColor(description);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(current.record?.preference.base).toBe(base);
    expect(current.palette.accent).not.toBe(defaultPalette.accent);
    expect(f.provider).not.toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalledOnce();
  },
);
it('offers an explicit model path for an unclear first description without silently saving pink', async () => {
  const f = await fixture(),
    nav = navigation();
  await mountWelcome(f.runtime, nav);
  await enterColor('像某个未命名星球的感觉');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(await f.themes.load()).toBeUndefined();
  expect(nav.navigate).not.toHaveBeenCalled();
  await act(async () =>
    renderer!.root.findByProps({ accessibilityLabel: '连接模型帮我理解' }).props.onPress(),
  );
  expect(await f.themes.opening()).toBe('像某个未命名星球的感觉');
  expect(nav.navigate).toHaveBeenCalledWith('Provider', { onboarding: true, skipTheme: false });
  await act(async () => {
    renderer!.update(
      tree(
        f.runtime,
        createElement(ProviderScreen, {
          navigation: nav,
          route: { params: { onboarding: true, skipTheme: false } },
        } as never),
      ),
    );
  });
  await act(async () =>
    renderer!.root
      .findByProps({ accessibilityLabel: 'API Key' })
      .props.onChangeText('test-key-only'),
  );
  await act(async () =>
    renderer!.root.findByProps({ accessibilityLabel: '开始聊天' }).props.onPress(),
  );
  expect(nav.reset).toHaveBeenCalledWith({
    index: 0,
    routes: [{ name: 'Chat', params: { characterId: 'egg-test' } }],
  });
  await act(async () => {
    renderer!.update(
      tree(
        f.runtime,
        createElement(ThemeScreen, {
          navigation: nav,
          route: { params: undefined },
        } as never),
      ),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(current.record).toMatchObject({ source: 'model', preference: { base: 'purple' } });
  expect(current.palette.accent).not.toBe(defaultPalette.accent);
  expect(f.modelCall).toHaveBeenCalledOnce();
  expect(await f.themes.opening()).toBeUndefined();
});
