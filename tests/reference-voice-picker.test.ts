import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { ReferenceVoicePicker } from '../src/ui/reference-voice-picker';
import { applyLocalReference } from '../src/speech/apply-local-reference';
import { createReferenceLookup } from '../src/speech/reference-lookup';
const mocks = vi.hoisted(() => ({
  runtime: {} as {
    store: { get: ReturnType<typeof vi.fn> };
    referenceTransport: { synthesize: ReturnType<typeof vi.fn> };
    voiceReferenceLookup: {
      peek: ReturnType<typeof vi.fn>;
      find: ReturnType<typeof vi.fn>;
      takeDeferredModel: ReturnType<typeof vi.fn>;
    };
    referenceVoice: {
      stageCandidate: ReturnType<typeof vi.fn>;
      useCandidate: ReturnType<typeof vi.fn>;
    };
  },
  state: vi.fn(),
  prepare: vi.fn(),
  enable: vi.fn(),
  download: vi.fn(),
  read: vi.fn(),
  play: vi.fn(),
  stop: vi.fn(),
  load: vi.fn(),
  convertPreview: vi.fn(),
  cancelPreview: vi.fn(),
  synthesize: vi.fn(),
}));
vi.mock('../src/ui/local-voice-download', () => ({ LocalVoiceDownload: 'LocalVoiceDownload' }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text' }));
vi.mock('../src/ui/context', () => ({ useRuntime: () => mocks.runtime }));
vi.mock('../src/theme/context', () => ({ usePalette: () => ({ ink: 'black', muted: 'gray' }) }));
vi.mock('../src/ui/components', () => ({
  Button: 'Button',
  Note: 'Note',
  TextButton: 'TextButton',
}));
vi.mock('../src/native/android', () => ({
  bridge: () => ({ downloadVoiceReference: mocks.download, stopSpeech: mocks.stop }),
}));
vi.mock('../src/speech/local-voice', () => ({
  localVoiceConversion: { preview: mocks.convertPreview, cancel: mocks.cancelPreview },
  localVoiceState: mocks.state,
  prepareBundledLocalVoice: mocks.prepare,
  setLocalVoiceEnabled: mocks.enable,
}));
vi.mock('../src/speech/local-tuning', () => ({
  tuneSpeechWav: async (bytes: Uint8Array) => bytes,
}));
vi.mock('../src/speech/reference-storage', () => ({
  readPickedReference: mocks.read,
  playReferenceWav: mocks.play,
  loadReferenceWav: mocks.load,
}));
const candidate = (label: string) => ({
  id: label,
  label: `${label} 中文自我介绍`,
  sourceUrl: `https://wiki.example/${encodeURIComponent(label)}`,
  audioUrl: `https://audio.example/${encodeURIComponent(label)}.wav`,
  language: 'zh' as const,
  usage: 'preview' as const,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.state.mockResolvedValue({ available: true, enabled: false, bundled: true });
  mocks.prepare.mockResolvedValue({ available: true, enabled: false, bundled: true });
  mocks.enable.mockResolvedValue({ available: true, enabled: true });
  mocks.download.mockResolvedValue({ uri: 'file://cache/exact.wav', sampleRate: 22050 });
  mocks.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.load.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.play.mockResolvedValue(true);
  mocks.convertPreview.mockResolvedValue(new Uint8Array([9, 9]));
  mocks.cancelPreview.mockResolvedValue(undefined);
  mocks.synthesize.mockResolvedValue(new Uint8Array([4, 4]));
  mocks.runtime = {
    referenceTransport: { synthesize: mocks.synthesize },
    store: { get: vi.fn(async () => ({ voice: {} })) },
    voiceReferenceLookup: {
      takeDeferredModel: vi.fn(() => false),
      peek: vi.fn(() => ({ candidates: [candidate('流萤'), candidate('卡芙卡')] })),
      find: vi.fn(async () => ({ candidates: [candidate('流萤')] })),
    },
    referenceVoice: {
      stageCandidate: vi.fn(async (_cid, _bytes, metadata) => ({
        ...metadata,
        id: 'persisted-exact',
      })),
      useCandidate: vi.fn(async () => {}),
    },
  };
});
async function render(query = '流萤') {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      createElement(ReferenceVoicePicker, { characterId: 'c', query, onSettings: vi.fn() }),
    );
  });
  const button = (title: string) =>
    tree.root.findAll(
      (n) =>
        (n.type === ('Button' as never) || n.type === ('TextButton' as never)) &&
        n.props.title === title,
    )[0];
  return { tree, button };
}
it('reads cached candidates without mount search and previews/applies exact selected source', async () => {
  const f = await render('卡芙卡');
  expect(mocks.runtime.voiceReferenceLookup.find).not.toHaveBeenCalled();
  expect(mocks.download).not.toHaveBeenCalled();
  await act(async () => {
    f.button('下载并试听：卡芙卡 中文自我介绍').props.onPress();
  });
  expect(mocks.download).toHaveBeenCalledWith(
    candidate('卡芙卡').audioUrl,
    candidate('卡芙卡').sourceUrl,
  );
  expect(mocks.runtime.referenceVoice.stageCandidate).toHaveBeenCalledWith(
    'c',
    new Uint8Array([1, 2, 3]),
    expect.objectContaining({
      query: '卡芙卡',
      label: '卡芙卡 中文自我介绍',
      sourceUrl: candidate('卡芙卡').sourceUrl,
      usage: 'preview',
    }),
  );
  expect(mocks.runtime.referenceVoice.useCandidate).not.toHaveBeenCalled();
  expect(JSON.stringify(f.tree.toJSON())).toContain('不是本机转换结果');
  await act(async () => {
    f.button('我有权使用，设为参考音色').props.onPress();
  });
  expect(mocks.enable).toHaveBeenCalledWith(true);
  expect(mocks.runtime.referenceVoice.useCandidate).toHaveBeenCalledExactlyOnceWith(
    'c',
    'persisted-exact',
  );
  expect(JSON.stringify(f.tree.toJSON())).toContain('尚未试听转换效果');
  await act(async () => f.tree.unmount());
});
it('explicit download completion continues the same deferred query once', async () => {
  mocks.state.mockResolvedValue({ available: false, enabled: false, bundled: false });
  mocks.runtime.voiceReferenceLookup.peek.mockReturnValue(undefined);
  const f = await render('崩铁流萤');
  expect(mocks.runtime.voiceReferenceLookup.find).not.toHaveBeenCalled();
  mocks.state.mockResolvedValue({ available: true, enabled: false, bundled: false });
  mocks.runtime.voiceReferenceLookup.takeDeferredModel.mockReturnValueOnce(true);
  await act(async () => {
    f.tree.root.findAll((n) => n.type === ('LocalVoiceDownload' as never))[0].props.onReady();
  });
  expect(mocks.runtime.voiceReferenceLookup.find).toHaveBeenCalledExactlyOnceWith('c', '崩铁流萤');
  expect(mocks.prepare).not.toHaveBeenCalled();
  await act(async () => f.tree.unmount());
});
it('failed reference persistence restores previously disabled engine and reports failure', async () => {
  const enable = vi.fn(async () => {});
  await expect(
    applyLocalReference(
      {
        state: async () => ({ available: true, enabled: false }),
        enable,
        apply: async () => {
          throw Error('stale candidate');
        },
      },
      'c',
      'expected',
    ),
  ).rejects.toThrow('stale candidate');
  expect(enable.mock.calls).toEqual([[true], [false]]);
});
it('lookup caches results and coalesces simultaneous identical requests without cross-role fallback', async () => {
  const find = vi.fn(async (query: string) => [candidate(query)]);
  const lookup = createReferenceLookup(find);
  await Promise.all([lookup.find('c', '流萤'), lookup.find('c', '流萤')]);
  expect(find).toHaveBeenCalledOnce();
  expect(lookup.peek('c', '流萤')?.candidates[0].label).toContain('流萤');
  expect(lookup.peek('c', '卡芙卡')).toBeUndefined();
});

it('converted audition requires its rights button and does not enable or apply settings', async () => {
  const f = await render('流萤');
  await act(async () => {
    f.button('下载并试听：流萤 中文自我介绍').props.onPress();
  });
  expect(mocks.synthesize).not.toHaveBeenCalled();
  mocks.play.mockClear();
  await act(async () => {
    f.button('我有权使用，试听本机换声（不应用）').props.onPress();
  });
  expect(mocks.synthesize).toHaveBeenCalledOnce();
  expect(mocks.convertPreview).toHaveBeenCalledOnce();
  expect(mocks.play).toHaveBeenCalledWith(
    'converted-preview:persisted-exact',
    new Uint8Array([9, 9]),
  );
  expect(mocks.enable).not.toHaveBeenCalled();
  expect(mocks.runtime.referenceVoice.useCandidate).not.toHaveBeenCalled();
  expect(JSON.stringify(f.tree.toJSON())).toContain('未应用此参考');
  await act(async () => f.tree.unmount());
});
it('failed converted audition never plays raw replacement or claims converted success', async () => {
  const f = await render('流萤');
  await act(async () => {
    f.button('下载并试听：流萤 中文自我介绍').props.onPress();
  });
  mocks.play.mockClear();
  mocks.convertPreview.mockRejectedValue(Error('converter error'));
  await act(async () => {
    f.button('我有权使用，试听本机换声（不应用）').props.onPress();
  });
  expect(mocks.play).not.toHaveBeenCalled();
  expect(mocks.enable).not.toHaveBeenCalled();
  expect(mocks.runtime.referenceVoice.useCandidate).not.toHaveBeenCalled();
  expect(JSON.stringify(f.tree.toJSON())).toContain('未播放原声替代');
  await act(async () => f.tree.unmount());
});
