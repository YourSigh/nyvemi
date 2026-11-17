import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalVoicePrepare } from '../src/ui/local-voice-prepare';
import { createLocalVoiceRequest } from '../src/speech/local-voice-request';
import { requestedVoiceReference, wantsVoiceSettings } from '../src/chat/voice-settings';
const mocks = vi.hoisted(() => ({ state: vi.fn(), prepare: vi.fn() }));
vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
}));
vi.mock('../src/ui/components', () => ({ Button: 'Button', Note: 'Note' }));
vi.mock('../src/speech/local-voice', () => ({
  localVoiceState: mocks.state,
  prepareBundledLocalVoice: mocks.prepare,
}));
afterEach(() => {
  vi.clearAllMocks();
});
async function render(bundled = true, available = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.state.mockResolvedValue({ bundled, available, enabled: false, detail: '' });
  mocks.prepare.mockResolvedValue({ bundled, available: true, enabled: false, detail: '' });
  let tree!: ReactTestRenderer;
  const settings = vi.fn();
  await act(async () => {
    tree = create(createElement(LocalVoicePrepare, { onSettings: settings }));
  });
  return {
    tree,
    settings,
    button: () => tree.root.findAll((n) => n.type === ('Button' as never))[0],
  };
}
it('offers one explicit local preparation action without starting from render', async () => {
  const f = await render();
  expect(f.tree.root.findAll((n) => n.type === ('Button' as never))).toHaveLength(1);
  expect(f.button().props.title).toBe('准备本机换声模型');
  expect(mocks.prepare).not.toHaveBeenCalled();
  await act(async () => {
    f.button().props.onPress();
  });
  expect(mocks.prepare).toHaveBeenCalledOnce();
  expect(f.button().props.title).toBe('打开声音设置');
  await act(async () => f.tree.unmount());
});
it('build without bundled weights offers import fallback instead of broken prepare', async () => {
  const f = await render(false);
  expect(JSON.stringify(f.tree.toJSON())).toContain('未附带模型');
  expect(f.button().props.title).toBe('打开声音设置');
  expect(mocks.prepare).not.toHaveBeenCalled();
  await act(async () => f.tree.unmount());
});
it('recognizes simple requested voice but not admiration, negation or hypothetical', () => {
  for (const text of ['想要流萤的声音', '我想要流萤的声音。', '想用卡芙卡的声线']) {
    expect(requestedVoiceReference(text)).toBeTruthy();
    expect(wantsVoiceSettings(text)).toBe(true);
  }
  for (const text of [
    '我喜欢流萤的声音',
    '不想要流萤的声音',
    '假如我想要流萤的声音',
    '想要更温柔的声音',
  ])
    expect(requestedVoiceReference(text)).toBeUndefined();
});
it('missing model request needs no companion and performs no preparation/reference lookup', async () => {
  const deps = {
    state: vi.fn(async () => ({ available: false })),
    hasCompanion: vi.fn(),
    requestReference: vi.fn(),
  };
  expect(await createLocalVoiceRequest(deps)('c', '流萤')).toContain('现在还没准备');
  expect(deps.hasCompanion).not.toHaveBeenCalled();
  expect(deps.requestReference).not.toHaveBeenCalled();
});
it('installed model without companion asks for authorized local WAV without applying public voice', async () => {
  const deps = {
    state: vi.fn(async () => ({ available: true })),
    hasCompanion: vi.fn(async () => false),
    requestReference: vi.fn(),
  };
  expect(await createLocalVoiceRequest(deps)('c', '流萤')).toContain('有权使用');
  expect(deps.requestReference).not.toHaveBeenCalled();
});
