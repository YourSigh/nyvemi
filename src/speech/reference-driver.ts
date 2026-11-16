import type { SpeechDriver } from './queue';
import type { VoiceOptions } from './preferences';
import type { ReferenceTransport } from './reference-transport';
import { assertReferenceWav } from './reference-transport';
import { tuneSpeechWav } from './local-tuning';

type PreparedSpeech = { bytes: Uint8Array; notice?: string };
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
    { key: string; controller: AbortController; result: Promise<PreparedSpeech> }
  >();
  function prepare(id: string, text: string, options: VoiceOptions) {
    const reference = options.referenceVoice;
    if (!options.enabled) return undefined;
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
    const result = (async (): Promise<PreparedSpeech> => {
      const signal = controller.signal;
      const optionalReference = reference?.id
        ? (async () => {
            try {
              if (!(await deps.transport.checkCompanion(signal, true))) return undefined;
              const bytes = await deps.loadReference(reference.id);
              assertReferenceWav(bytes);
              return bytes;
            } catch {
              return undefined;
            }
          })()
        : undefined;
      const source = await deps.transport.synthesize(text, signal, options.deepSeekVoice);
      if (signal.aborted) throw Error('已取消');
      let bytes = source;
      let notice: string | undefined;
      if (optionalReference) {
        const sample = await optionalReference;
        if (signal.aborted) throw Error('已取消');
        try {
          if (!sample) throw Error('参考换声不可用');
          bytes = await deps.transport.convert(source, sample, signal);
        } catch {
          if (signal.aborted) throw Error('已取消');
          notice = '参考换声不可用，已使用 DeepSeek 声音';
        }
      }
      if (options.localTuning) {
        try {
          bytes = await tuneSpeechWav(bytes, options.localTuning, signal);
        } catch {
          if (signal.aborted) throw Error('已取消');
          notice = '本地调音未完成，已保留未调音的声音';
        }
      }
      return { bytes, notice };
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
        const { bytes, notice } = await entry.result;
        if (epoch !== generation || entry.controller.signal.aborted) return false;
        if (notice) deps.onFallback?.(notice);
        const played = await deps.playWav(id, bytes);
        if (epoch !== generation || entry.controller.signal.aborted) return false;
        if (!played) throw Error('播放失败');
        return true;
      } catch {
        if (epoch !== generation || entry.controller.signal.aborted) return false;
        deps.onFallback?.('DeepSeek 语音暂不可用，已切换系统离线声音');
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
