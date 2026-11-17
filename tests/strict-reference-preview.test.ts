import { expect, it, vi } from 'vitest';
import { strictReferencePreview } from '../src/speech/strict-reference-preview';
function fixture() {
  const source = new Uint8Array([1]),
    reference = new Uint8Array([2]),
    converted = new Uint8Array([3]);
  const deps = {
    ready: vi.fn(async () => true),
    loadReference: vi.fn(async () => reference),
    synthesize: vi.fn(async () => source),
    convert: vi.fn(async () => converted),
    play: vi.fn(async () => true),
  };
  const controller = new AbortController();
  return {
    deps,
    controller,
    source,
    reference,
    converted,
    run: () => strictReferencePreview(deps, 'selected-exact-id', controller.signal),
  };
}
it('synthesizes once and plays only the successful conversion of the exact selected reference', async () => {
  const f = fixture();
  await f.run();
  expect(f.deps.loadReference).toHaveBeenCalledWith('selected-exact-id');
  expect(f.deps.synthesize).toHaveBeenCalledOnce();
  expect(f.deps.convert).toHaveBeenCalledWith(f.source, f.reference, f.controller.signal);
  expect(f.deps.play).toHaveBeenCalledExactlyOnceWith(f.converted);
});
it.each(['model', 'reference', 'synthesis', 'conversion'])(
  'never plays fallback on %s failure',
  async (stage) => {
    const f = fixture();
    if (stage === 'model') f.deps.ready.mockResolvedValue(false);
    if (stage === 'reference') f.deps.loadReference.mockRejectedValue(Error('missing'));
    if (stage === 'synthesis') f.deps.synthesize.mockRejectedValue(Error('failed'));
    if (stage === 'conversion') f.deps.convert.mockRejectedValue(Error('failed'));
    await expect(f.run()).rejects.toThrow();
    expect(f.deps.play).not.toHaveBeenCalled();
    if (stage === 'model' || stage === 'reference')
      expect(f.deps.synthesize).not.toHaveBeenCalled();
  },
);
it('late conversion after cancellation never plays', async () => {
  const f = fixture();
  let finish!: (bytes: Uint8Array<ArrayBuffer>) => void;
  f.deps.convert.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.run();
  const assertion = expect(pending).rejects.toThrow('已取消');
  await vi.waitFor(() => expect(f.deps.convert).toHaveBeenCalledOnce());
  f.controller.abort();
  finish(f.converted);
  await assertion;
  expect(f.deps.play).not.toHaveBeenCalled();
});
it('interrupted playback is not reported as a successful audition', async () => {
  const f = fixture();
  f.deps.play.mockResolvedValue(false);
  await expect(f.run()).rejects.toThrow('未播放完成');
});
