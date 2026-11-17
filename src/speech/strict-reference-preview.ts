/** One explicitly authorized audition. No raw/system fallback and no settings writes. */
export async function strictReferencePreview(
  deps: {
    ready(): Promise<boolean>;
    loadReference(id: string): Promise<Uint8Array>;
    synthesize(signal: AbortSignal): Promise<Uint8Array>;
    convert(source: Uint8Array, reference: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
    tune?(converted: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
    play(converted: Uint8Array): Promise<boolean>;
  },
  referenceId: string,
  signal: AbortSignal,
) {
  const check = () => {
    if (signal.aborted) throw Error('试听已取消，未应用参考');
  };
  check();
  if (!(await deps.ready())) throw Error('本机模型尚未就绪，未开始换声试听');
  check();
  const reference = await deps.loadReference(referenceId);
  check();
  const source = await deps.synthesize(signal);
  check();
  let converted = await deps.convert(source, reference, signal);
  check();
  if (deps.tune) converted = await deps.tune(converted, signal);
  check();
  const played = await deps.play(converted);
  check();
  if (!played) throw Error('转换后的音频未播放完成，未应用参考');
}
