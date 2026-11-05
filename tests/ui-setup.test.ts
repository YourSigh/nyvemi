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
import { qualityImageSettings } from '../src/appearance/settings';
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
vi.mock('../src/ui/character/rig', () => ({
  CharacterImage: 'CharacterImage',
  RigCharacter: 'RigCharacter',
}));
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
  expect(runtime.visuals.select).toHaveBeenCalledWith('c', 1, expect.any(Function));
});
it('starts drawing directly after entering a key without a reference selection screen', async () => {
  const { runtime, store } = await fixture();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    createdAt: 1,
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  });
  runtime.visuals.generate = vi.fn(async () => ({
    id: 'c',
    characterId: 'c',
    createdAt: 1,
    providerId: 'seedream:test',
    input: { mode: 'text' as const, description: '角色' },
    candidates: [{ uri: 'file://one', width: 512, height: 1024 }],
  }));
  await mount(
    runtime,
    createElement(AppearanceScreen, {
      route: { params: { characterId: 'c' } },
      navigation: {},
    } as never),
  );
  await act(async () => button('豆包 API Key').props.onChangeText('test-drawing-key'));
  await act(async () => button('生成3张候选图').props.onPress());
  expect(runtime.visuals.generate).toHaveBeenCalledOnce();
  expect(runtime.visuals.generate).toHaveBeenCalledWith(
    'c',
    expect.any(Object),
    expect.objectContaining({ regenerate: false }),
  );
  expect(images.set).toHaveBeenCalledWith('test-drawing-key', defaultImageSettings.baseUrl);
  expect(renderer!.root.findAllByProps({ accessibilityLabel: '选择参考 1' })).toHaveLength(0);
  expect(button('选择形象 1')).toBeDefined();
});
it('treats automatic review as advisory and can recheck without requiring a drawing key', async () => {
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
  expect(button('就选这张，整理图层').props.disabled).toBe(false);
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
  await act(async () => button('豆包 API Key').props.onChangeText('test-key'));
  await act(async () => button('生成3张候选图').props.onPress());
  expect(JSON.stringify(renderer!.toJSON())).toContain('本次生成结果未通过服务商审核');
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('safe-request-123');
  await act(async () => button('错误详情').props.onPress());
  expect(JSON.stringify(renderer!.toJSON())).toContain('safe-request-123');
  expect(JSON.stringify(renderer!.toJSON())).toContain('OutputImageSensitiveContentDetected');
});

it('image routing presets save without calling models and preserve custom settings until explicitly changed', async () => {
  const { runtime, store, provider } = await fixture();
  const custom = {
    ...qualityImageSettings,
    baseUrl: 'https://custom.example/v3',
    imageModel: 'ep-own',
    layerModel: 'ep-layers',
  };
  await store.put('imageSettings', custom);
  await mount(runtime, createElement(MediaSettingsScreen));
  await act(async () => button('保存').props.onPress());
  expect(await store.get('imageSettings', 'images')).toEqual(custom);
  await act(async () => button('自定义生图与后台权限').props.onPress());
  await act(async () => button('省钱组合：Pro生图 + Flash拆层').props.onPress());
  expect(await store.get('imageSettings', 'images')).toEqual(custom);
  await act(async () => button('保存').props.onPress());
  expect(await store.get('imageSettings', 'images')).toEqual(defaultImageSettings);
  await act(async () => button('使用Pro生图 + Pro拆层').props.onPress());
  await act(async () => button('保存').props.onPress());
  expect(await store.get('imageSettings', 'images')).toEqual(qualityImageSettings);
  expect(provider).not.toHaveBeenCalled();
  expect(runtime.visuals.select).not.toHaveBeenCalled();
});

it('shows the failing visual stage with folded safe schema details and persists diagnostics', async () => {
  const { StructuredOutputError } = await import('../src/providers/structured-error');
  const { runtime, store } = await fixture();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    createdAt: 1,
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  });
  runtime.visuals.generate = vi.fn(async () => {
    throw new StructuredOutputError('visual_reference_review', 'schema', [
      {
        code: 'invalid_type',
        path: ['features', 0],
        expected: 'string',
        received: 'number',
        message: 'private-schema-message',
      },
    ]);
  });
  await mount(
    runtime,
    createElement(AppearanceScreen, {
      route: { params: { characterId: 'c', onboarding: true } },
      navigation: {},
    } as never),
  );
  await act(async () => button('豆包 API Key').props.onChangeText('test-key'));
  await act(async () => button('生成3张候选图').props.onPress());
  expect(JSON.stringify(renderer!.toJSON())).toContain('参考图核对返回格式有误');
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('invalid_type');
  await act(async () => button('错误详情').props.onPress());
  expect(JSON.stringify(renderer!.toJSON())).toContain('features.0');
  expect((await store.list('diagnostics'))[0]).toMatchObject({
    kind: 'error',
    characterId: 'c',
    data: { event: 'visual_schema', purpose: 'visual_reference_review' },
  });
});
it('uses an uploaded image directly and does not ask the user to select the same reference again', async () => {
  const { runtime, store } = await fixture();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    createdAt: 1,
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  });
  images.get.mockResolvedValue('stored');
  const { pickReference } = await import('../src/appearance/native');
  const uploaded = { uri: 'file://my-upload', width: 1024, height: 1536 };
  vi.mocked(pickReference).mockResolvedValue(uploaded);
  runtime.visuals.generate = vi.fn(async (_cid, input) => ({
    id: 'c',
    characterId: 'c',
    createdAt: 1,
    providerId: 'seedream:test',
    input,
    candidates: [uploaded],
  }));
  await mount(
    runtime,
    createElement(AppearanceScreen, {
      route: { params: { characterId: 'c' } },
      navigation: {},
    } as never),
  );
  const tab = renderer!.root
    .findAllByType('Pressable' as never)
    .find((n) => n.findAllByType('Text' as never).some((t) => t.props.children === '加参考图'))!;
  await act(async () => tab.props.onPress());
  await act(async () => button('上传参考图').props.onPress());
  await act(async () => button('生成3张候选图').props.onPress());
  expect(runtime.visuals.generate).toHaveBeenCalledWith(
    'c',
    expect.objectContaining({ mode: 'reference', reference: uploaded }),
    expect.any(Object),
  );
  expect(renderer!.root.findAllByProps({ accessibilityLabel: '选择参考 1' })).toHaveLength(0);
});
it('shows a real partially built character on failure without claiming it is awake', async () => {
  const { runtime, store } = await fixture();
  const source = { uri: 'file://source', width: 1024, height: 1024 };
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
    input: { description: '角色', mode: 'text' },
    selected: source,
    candidates: [source],
  });
  runtime.visuals.select = vi.fn(async (_cid, _index, progress) => {
    progress?.({
      stage: 'layers',
      source,
      completed: 1,
      total: 6,
      preview: { width: 1024, height: 1024, layers: mockRig('x').layers.slice(0, 1) },
    });
    progress?.({
      stage: 'failed',
      failedStage: 'layers',
      source,
      completed: 1,
      total: 6,
      preview: { width: 1024, height: 1024, layers: mockRig('x').layers.slice(0, 1) },
    });
    throw Error('下载失败，已保留图层');
  });
  await mount(
    runtime,
    createElement(AppearanceScreen, {
      route: { params: { characterId: 'c' } },
      navigation: {},
    } as never),
  );
  await act(async () => button('选择形象 1').props.onPress());
  await act(async () => button('就选这张，整理图层').props.onPress());
  expect(renderer!.root.findAllByProps({ testID: 'visual-build-preview' })).toHaveLength(1);
  expect(renderer!.root.findAllByType('RigCharacter' as never)).toHaveLength(1);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('醒来了');
  expect(button('继续制作')).toBeDefined();
});
