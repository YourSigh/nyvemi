import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageProviderError } from '../src/appearance/errors';
import { ProviderScreen } from '../src/ui/onboarding';
import { MediaSettingsScreen } from '../src/ui/media-settings';
import { AppearanceScreen } from '../src/ui/appearance';
import { RuntimeContext } from '../src/ui/context';
import type { Runtime } from '../src/application/runtime';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { deepSeekPreset } from '../src/providers/provider';
import { defaultImageSettings } from '../src/appearance/model';
import { defaultMediaSettings } from '../src/media/model';
import { defaultPalette } from '../src/theme/generator';
import { saveProviderSettings } from '../src/application/provider-settings';
import { demoPersona } from './persona-fixture';
import { mockRig } from '../src/appearance/mock';
const secrets = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
const images = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
vi.mock('../src/storage/native', () => ({ secretStore: secrets }));
vi.mock('../src/appearance/native', () => ({
  imageSecret: images,
  pickReference: vi.fn(),
  pickLayeredLook: vi.fn(),
}));
vi.mock('../src/media/native', () => ({
  visionSecret: { get: vi.fn(async () => null), set: vi.fn() },
}));
vi.mock('../src/avatar/native', () => ({ pickMeshAvatar: vi.fn() }));
vi.mock('../src/native/presence', () => ({ startCompanionPresence: vi.fn() }));
vi.mock('../src/ui/character/rig', () => ({ CharacterImage: 'CharacterImage' }));
vi.mock('../src/ui/character/stage', () => ({ CharacterStage: 'CharacterStage' }));
vi.mock('../src/theme/context', () => ({
  usePalette: () => defaultPalette,
  useTheme: () => ({ palette: defaultPalette, transitioning: false }),
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Switch: 'Switch',
  StyleSheet: { create: (styles: unknown) => styles },
  Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove() {} }) },
  AppState: { currentState: 'active' },
  Alert: { alert: vi.fn() },
  Linking: { openURL: vi.fn() },
  useWindowDimensions: () => ({ width: 360, height: 720 }),
}));
vi.mock('@react-navigation/native', async () => {
  const { createContext, useEffect } = await import('react');
  return {
    NavigationContext: createContext(undefined),
    useFocusEffect: (effect: Parameters<typeof useEffect>[0]) => useEffect(effect, [effect]),
  };
});
vi.mock('@react-navigation/elements', async () => {
  const { createContext } = await import('react');
  return { HeaderShownContext: createContext(true) };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
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
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  secrets.get.mockResolvedValue(null);
  images.get.mockResolvedValue(null);
  images.set.mockImplementation(async () => images.get.mockResolvedValue('stored-test-image-key'));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
});
async function fixture() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const provider = vi.fn();
  const runtime = {
    store,
    provider,
    saveProvider: (config: typeof deepSeekPreset, key: string) =>
      saveProviderSettings(store, secrets, config, key),
    media: {
      settings: async () => (await store.get('mediaSettings', 'media')) ?? defaultMediaSettings,
    },
    visuals: { select: vi.fn(async () => mockRig('test')) },
  } as unknown as Runtime;
  return { runtime, store, provider };
}
async function mount(runtime: Runtime, screen: ReactNode) {
  await act(async () => {
    renderer = create(createElement(RuntimeContext.Provider, { value: runtime }, screen));
  });
}
const button = (label: string) => renderer!.root.findByProps({ accessibilityLabel: label });
it('new users only enter a DeepSeek key; saving uses defaults without a model request', async () => {
  const { runtime, store, provider } = await fixture();
  await mount(runtime, createElement(ProviderScreen, { route: {}, navigation: {} } as never));
  expect(renderer!.root.findAllByType('TextInput' as never)).toHaveLength(1);
  expect(button('自定义模型').props.accessibilityState.expanded).toBe(false);
  await act(async () => button('API Key').props.onChangeText('test-chat-key'));
  await act(async () => button('保存设置').props.onPress());
  expect(await store.get('provider', 'provider')).toEqual(deepSeekPreset);
  expect(secrets.set).toHaveBeenCalledWith('test-chat-key');
  expect(provider).not.toHaveBeenCalled();
  await act(async () => button('自定义模型').props.onPress());
  expect(button('Base URL').props.value).toBe(deepSeekPreset.baseUrl);
  await act(async () => button('自定义模型').props.onPress());
  expect(renderer!.root.findAllByType('TextInput' as never)).toHaveLength(1);
});
it('keeps an existing custom model even when the custom fields are folded', async () => {
  const { runtime, store } = await fixture();
  const custom = { ...deepSeekPreset, baseUrl: 'https://custom.example/v1', model: 'own-model' };
  await store.put('provider', custom);
  secrets.get.mockResolvedValue('existing-test-key');
  await mount(runtime, createElement(ProviderScreen, { route: {}, navigation: {} } as never));
  await act(async () => button('保存设置').props.onPress());
  expect(await store.get('provider', 'provider')).toEqual(custom);
  expect(secrets.set).not.toHaveBeenCalled();
});
it('a Doubao key enables chat drawing with preset endpoints and leaves autonomous paid drawing off', async () => {
  const { runtime, store } = await fixture();
  await mount(runtime, createElement(MediaSettingsScreen));
  expect(renderer!.root.findAllByType('TextInput' as never)).toHaveLength(1);
  await act(async () => button('生图 API Key').props.onChangeText('test-image-key'));
  await act(async () => button('保存').props.onPress());
  expect(await store.get('imageSettings', 'images')).toEqual(defaultImageSettings);
  expect(await store.get('mediaSettings', 'media')).toMatchObject({
    visionSource: 'chat',
    drawingEnabled: true,
    autonomousDrawing: false,
  });
  expect(images.set).toHaveBeenCalledWith('test-image-key', defaultImageSettings.baseUrl);
});
it('candidate cards only select; decomposition starts after explicit confirmation', async () => {
  const { runtime, store } = await fixture();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    createdAt: 1,
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  });
  await store.put('visualDrafts', {
    id: 'c',
    characterId: 'c',
    createdAt: 1,
    providerId: 'seedream:test',
    input: { mode: 'text', description: 'test' },
    candidates: [1, 2, 3].map((i) => ({ uri: `file://candidate-${i}`, width: 100, height: 200 })),
  });
  await mount(
    runtime,
    createElement(AppearanceScreen, {
      route: { params: { characterId: 'c' } },
      navigation: {},
    } as never),
  );
  expect(button('就选这张，整理图层').props.disabled).toBe(true);
  await act(async () => button('选择形象 2').props.onPress());
  expect(runtime.visuals.select).not.toHaveBeenCalled();
  const thumbnails = renderer!.root.findAllByType('CharacterImage' as never);
  expect(thumbnails).toHaveLength(3);
  expect(thumbnails.every((image) => image.props.width <= 100)).toBe(true);
  await act(async () => button('就选这张，整理图层').props.onPress());
  expect(runtime.visuals.select).toHaveBeenCalledWith('c', 1);
});
it('finds and confirms references before requiring a drawing key or starting paid generation', async () => {
  const { runtime, store } = await fixture();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    createdAt: 1,
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  });
  const check = { status: 'match' as const, features: ['参考中实际可见的发型'], issues: [] };
  const prepared = {
    id: 'c',
    characterId: 'c',
    createdAt: 1,
    providerId: 'seedream:test',
    input: { mode: 'text' as const, description: '角色' },
    promptVersion: 3 as const,
    candidates: [],
    research: {
      version: 1 as const,
      status: 'awaiting_reference' as const,
      brief: {
        subject: '角色',
        namedCharacter: true,
        recognizableFeatures: [],
        style: '',
        confidence: 0.95,
      },
      references: [
        { id: 'ref', title: '来源', asset: { uri: 'file://ref', width: 512, height: 1024 }, check },
      ],
    },
  };
  runtime.visuals.generate = vi.fn(async () => prepared);
  await mount(
    runtime,
    createElement(AppearanceScreen, {
      route: { params: { characterId: 'c' } },
      navigation: {},
    } as never),
  );
  await act(async () => button('先确认角色与参考').props.onPress());
  expect(runtime.visuals.generate).toHaveBeenCalledWith(
    'c',
    expect.any(Object),
    expect.objectContaining({ planOnly: true }),
  );
  expect(images.set).not.toHaveBeenCalled();
  expect(button('确认，生成3张候选图').props.disabled).toBe(true);
  await act(async () => button('选择参考 1').props.onPress());
  expect(runtime.visuals.generate).toHaveBeenCalledOnce();
  await act(async () => button('豆包 API Key').props.onChangeText('test-drawing-key'));
  await act(async () => button('确认，生成3张候选图').props.onPress());
  expect(runtime.visuals.generate).toHaveBeenLastCalledWith(
    'c',
    expect.any(Object),
    expect.objectContaining({ referenceId: 'ref' }),
  );
  expect(images.set).toHaveBeenCalledWith('test-drawing-key', defaultImageSettings.baseUrl);
});
it('blocks decomposition for a mismatch and can recheck completed images without requiring a drawing key', async () => {
  const { runtime, store } = await fixture();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    createdAt: 1,
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  });
  const draft = {
    id: 'c',
    characterId: 'c',
    createdAt: 1,
    providerId: 'seedream:test',
    input: { mode: 'text' as const, description: '角色' },
    promptVersion: 3 as const,
    candidates: [1, 2, 3].map((i) => ({ uri: `file://candidate-${i}`, width: 100, height: 200 })),
    candidateReviews: [
      { status: 'mismatch' as const, features: [], issues: ['发型不符'] },
      null,
      null,
    ],
    research: {
      version: 1 as const,
      status: 'ready' as const,
      brief: {
        subject: '角色',
        namedCharacter: false,
        recognizableFeatures: [],
        style: '',
        confidence: 0.95,
      },
      references: [],
    },
  };
  await store.put('visualDrafts', draft);
  runtime.visuals.generate = vi.fn(async () => draft);
  await mount(
    runtime,
    createElement(AppearanceScreen, {
      route: { params: { characterId: 'c' } },
      navigation: {},
    } as never),
  );
  await act(async () => button('选择形象 1').props.onPress());
  expect(button('就选这张，整理图层').props.disabled).toBe(true);
  expect(runtime.visuals.select).not.toHaveBeenCalled();
  await act(async () => button('重新核对（不重新生图）').props.onPress());
  expect(runtime.visuals.generate).toHaveBeenCalledWith(
    'c',
    expect.any(Object),
    expect.objectContaining({ reviewAgain: true }),
  );
  expect(images.set).not.toHaveBeenCalled();
});
it('shows safe provider error details only when requested, including during first creation', async () => {
  const { runtime, store } = await fixture();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    createdAt: 1,
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  });
  runtime.visuals.generate = vi.fn(async () => {
    throw new ImageProviderError({
      httpStatus: 400,
      code: 'OutputImageSensitiveContentDetected',
      category: 'content_review',
      requestId: 'safe-request-123',
    });
  });
  await mount(
    runtime,
    createElement(AppearanceScreen, {
      route: { params: { characterId: 'c', onboarding: true } },
      navigation: {},
    } as never),
  );
  await act(async () => button('先确认角色与参考').props.onPress());
  expect(JSON.stringify(renderer!.toJSON())).toContain('服务商内容审核未通过');
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('safe-request-123');
  await act(async () => button('错误详情').props.onPress());
  expect(JSON.stringify(renderer!.toJSON())).toContain('safe-request-123');
  expect(JSON.stringify(renderer!.toJSON())).toContain('OutputImageSensitiveContentDetected');
});
