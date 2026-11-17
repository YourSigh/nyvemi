import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalVoiceDownload } from '../src/ui/local-voice-download';
const mocks = vi.hoisted(() => ({
  model: vi.fn(),
  state: vi.fn(),
  start: vi.fn(),
  pause: vi.fn(),
}));
vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
}));
vi.mock('../src/ui/components', () => ({ Button: 'Button', Note: 'Note' }));
vi.mock('../src/speech/local-voice', () => ({
  localVoiceState: mocks.model,
  localVoiceDownloadState: mocks.state,
  downloadLocalVoicePack: mocks.start,
  pauseLocalVoiceDownload: mocks.pause,
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
async function render(phase = 'missing', installed = false, configured = true) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.model.mockResolvedValue({ available: installed, enabled: false });
  mocks.state.mockResolvedValue({ phase, bytes: 1024, size: 122900000, configured });
  const ready = vi.fn();
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(LocalVoiceDownload, { onReady: ready }));
  });
  return { tree, ready, button: () => tree.root.findAll((n) => n.type === ('Button' as never))[0] };
}
it('does not start on mount and requires explicit 117.2 MiB download action', async () => {
  const f = await render();
  expect(mocks.start).not.toHaveBeenCalled();
  expect(f.button().props.title).toBe('下载本机换声模型（117.2 MiB）');
  await act(async () => {
    f.button().props.onPress();
  });
  expect(mocks.start).toHaveBeenCalledOnce();
  await act(async () => f.tree.unmount());
});
it.each([
  ['downloading', '取消下载（保留进度）'],
  ['paused', '继续下载模型'],
  ['error', '重试下载模型'],
])('supports %s action', async (phase, title) => {
  const f = await render(phase);
  expect(f.button().props.title).toBe(title);
  await act(async () => {
    f.button().props.onPress();
  });
  expect(phase === 'downloading' ? mocks.pause : mocks.start).toHaveBeenCalledOnce();
  await act(async () => f.tree.unmount());
});
it('preserves installed model without another download, even when endpoint unavailable', async () => {
  const f = await render('unconfigured', true, false);
  expect(f.button()).toBeUndefined();
  expect(f.ready).toHaveBeenCalledOnce();
  expect(mocks.start).not.toHaveBeenCalled();
  await act(async () => f.tree.unmount());
});
it('unconfigured endpoint gives disabled CTA instead of inventing a URL', async () => {
  const f = await render('unconfigured', false, false);
  expect(f.button().props.disabled).toBe(true);
  expect(JSON.stringify(f.tree.toJSON())).toContain('尚未配置');
  expect(mocks.start).not.toHaveBeenCalled();
  await act(async () => f.tree.unmount());
});
it('signals readiness only once when polling observes installation completion', async () => {
  vi.useFakeTimers();
  const f = await render('downloading');
  mocks.model.mockResolvedValue({ available: true, enabled: false });
  mocks.state.mockResolvedValue({ phase: 'ready', configured: true, bytes: 1, size: 1 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
  expect(f.ready).toHaveBeenCalledOnce();
  expect(mocks.start).not.toHaveBeenCalled();
  await act(async () => f.tree.unmount());
});
