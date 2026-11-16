import type { SpeechDriver } from './queue';
import type { VoiceOptions } from './preferences';
import type { ReferenceTransport } from './reference-transport';
import { assertReferenceWav } from './reference-transport';

type ReferenceOptions = VoiceOptions & { referenceVoice?: { id: string; label: string } };
export function createReferenceSpeechDriver(deps: {
  transport: ReferenceTransport;
  loadReference(id: string): Promise<Uint8Array>;
  playWav(id: string, bytes: Uint8Array): Promise<boolean>;
  fallback: SpeechDriver;
  stopPlayback?(): Promise<void>;
  releasePlayback?(): Promise<void>;
  onFallback?(message: string): void;
}): SpeechDriver {
  let epoch = 0;
  const cache = new Map<
    string,
    { key: string; controller: AbortController; result: Promise<Uint8Array> }
  >();
  function prepare(id: string, text: string, options: ReferenceOptions) {
    const reference = options.referenceVoice;
    if (!reference?.id || !options.enabled) return undefined;
    const key = JSON.stringify([text, options]);
    const old = cache.get(id);
    if (old?.key === key) return old;
    old?.controller.abort();
    cache.delete(id);
    while (cache.size >= 3) {
      const first = cache.keys().next().value!;
      cache.get(first)?.controller.abort();
      cache.delete(first);
    }
    const controller = new AbortController();
    const result = (async () => {
      const ref = await deps.loadReference(reference.id);
      assertReferenceWav(ref);
      if (controller.signal.aborted) throw Error('已取消');
      if (!(await deps.transport.checkCompanion(controller.signal, true)))
        throw Error('本机换声服务没有就绪');
      const source = await deps.transport.synthesize(text, controller.signal);
      if (controller.signal.aborted) throw Error('已取消');
      return deps.transport.convert(source, ref, controller.signal);
    })();
    // A speculative preparation can fail before play consumes it.
    void result.catch(() => {});
    const entry = { key, controller, result };
    cache.set(id, entry);
    return entry;
  }
  const cancel = () => {
    epoch++;
    for (const entry of cache.values()) entry.controller.abort();
    cache.clear();
  };
  return {
    prepare(id, text, options) {
      const entry = prepare(id, text, options);
      if (!entry) return deps.fallback.prepare?.(id, text, options);
      return entry.result.then(
        () => !entry.controller.signal.aborted,
        () => false,
      );
    },
    async play(id, text, options) {
      const generation = epoch,
        entry = prepare(id, text, options);
      if (!entry) return deps.fallback.play(id, text, options);
      try {
        const bytes = await entry.result;
        if (epoch !== generation || entry.controller.signal.aborted) return false;
        const played = await deps.playWav(id, bytes);
        if (epoch !== generation || entry.controller.signal.aborted) return false;
        if (!played) throw Error('播放失败');
        return true;
      } catch {
        if (epoch !== generation || entry.controller.signal.aborted) return false;
        deps.onFallback?.('参考音色暂不可用，已切换本机声音');
        return deps.fallback.play(id, text, options);
      } finally {
        if (cache.get(id) === entry) cache.delete(id);
      }
    },
    async stop() {
      cancel();
      await Promise.all([deps.fallback.stop(), deps.stopPlayback?.()]);
    },
    async release() {
      cancel();
      await Promise.all([
        deps.fallback.release?.() ?? deps.fallback.stop(),
        deps.releasePlayback?.() ?? deps.stopPlayback?.(),
      ]);
    },
  };
}
