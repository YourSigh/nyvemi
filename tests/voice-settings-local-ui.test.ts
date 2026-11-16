import { VoiceSettingsScreen } from '../src/ui/voice-settings';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const play = vi.fn(async () => true),
    stop = vi.fn(async () => {});
  const settings = {
    voice: { enabled: false, rate: 1, pitch: 1, referenceVoice: { id: 'ref', label: 'Reference' } },
  };
  return {
    play,
    stop,
    settings,
    save: vi.fn(async (_s: unknown, _c: unknown, p: object) => ({ ...settings.voice, ...p })),
    runtime: { store: { get: vi.fn(async () => settings) }, voiceDriver: () => ({ play, stop }) },
  };
});
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Switch: 'Switch' }));
vi.mock('@react-native-community/slider', () => ({ default: 'Slider' }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('@react-navigation/native', async () => {
  const React = await import('react');
  return { useFocusEffect: (fn: () => void) => React.useEffect(fn, [fn]) };
});
vi.mock('../src/ui/context', () => ({ useRuntime: () => mocks.runtime }));
vi.mock('../src/theme/context', () => ({
  usePalette: () => ({ ink: 'black', muted: 'gray', accent: 'blue', line: 'gray' }),
}));
vi.mock('../src/ui/components', () =>
  Object.fromEntries(
    [
      'Page',
      'Heading',
      'Note',
      'Details',
      'Button',
      'TextButton',
      'ErrorText',
      'Card',
      'Field',
    ].map((k) => [k, k]),
  ),
);
vi.mock('../src/speech/reference-storage', () => ({
  getVoiceCompanion: async () => undefined,
  deleteVoiceCompanion: vi.fn(),
  loadReferenceWav: vi.fn(),
  playReferenceWav: vi.fn(),
  readPickedReference: vi.fn(),
  saveVoiceCompanion: vi.fn(),
}));
vi.mock('../src/speech/preferences', () => ({
  voiceProfile: () => ({ enabled: false, rate: 1, pitch: 1 }),
  voiceOptions: (v: unknown) => v,
  updateVoice: mocks.save,
}));
it('shows seven local sliders, previews unsaved ordinary DSP without reference, applies explicitly', async () => {
  vi.stubGlobal('__DEV__', false);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      createElement(VoiceSettingsScreen, { route: { params: { characterId: 'c' } } } as never),
    );
  });
  const sliders = tree.root.findAll((n) => n.type === ('Slider' as never));
  expect(sliders).toHaveLength(7);
  expect(sliders.map((s) => [s.props.minimumValue, s.props.maximumValue, s.props.step])).toEqual([
    [-4, 4, 0.5],
    [-100, 100, 5],
    [-100, 100, 5],
    [-100, 100, 5],
    [-100, 100, 5],
    [0.7, 1.3, 0.05],
    [0, 1.5, 0.05],
  ]);
  expect(JSON.stringify(tree.toJSON())).not.toMatch(/Qwen|系统音色|下载语音包/);
  await act(async () => {
    sliders[0].props.onValueChange(2);
  });
  expect(mocks.save).not.toHaveBeenCalled();
  const button = (title: string) =>
    tree.root.findAll((n) => n.type === ('Button' as never) && n.props.title === title)[0];
  await act(async () => {
    button('普通试听').props.onPress();
  });
  expect(mocks.play).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expect.objectContaining({
      enabled: true,
      referenceVoice: undefined,
      localTuning: expect.objectContaining({ pitch: 2 }),
    }),
  );
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => {
    button('应用到聊天').props.onPress();
  });
  expect(mocks.save).toHaveBeenCalledWith(mocks.runtime.store, 'c', {
    localTuning: expect.objectContaining({ pitch: 2 }),
  });
  await act(async () => tree.unmount());
  vi.unstubAllGlobals();
});
