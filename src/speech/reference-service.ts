import type { VoiceReference } from '../domain/models';
import type { Storage } from '../storage/store';
import { voiceOptions } from './preferences';

type Resolution = {
  label: string;
  wav: Uint8Array;
  usage: 'preview' | 'reference';
};
type Files = {
  save: (bytes: Uint8Array, label: string) => VoiceReference;
  remove: (id: string) => void;
};

export function createReferenceVoiceService(
  store: Storage,
  files: Files,
  resolve: (query: string, signal?: AbortSignal) => Promise<Resolution>,
  hasCompanion: () => Promise<boolean>,
) {
  async function put(
    cid: string,
    bytes: Uint8Array,
    label: string,
    use: boolean,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) throw Error('换声请求已取消');
    const reference = files.save(bytes, label);
    try {
      const removed = await store.atomic(async (tx) => {
        const settings = await tx.get('settings', cid);
        if (!settings) throw Error('角色不存在');
        if (signal?.aborted) throw Error('换声请求已取消');
        const voice = voiceOptions(settings.voice);
        const removed = use ? voice.referenceVoice : voice.referenceCandidate;
        await tx.put('settings', {
          ...settings,
          voice: use
            ? { ...voice, referenceVoice: reference, enabled: true, playbackSet: true }
            : { ...voice, referenceCandidate: reference },
        });
        return removed &&
          removed.id !== (use ? voice.referenceCandidate?.id : voice.referenceVoice?.id)
          ? removed
          : undefined;
      });
      if (removed) files.remove(removed.id);
      return reference;
    } catch (error) {
      files.remove(reference.id);
      throw error;
    }
  }
  return {
    async request(cid: string, query: string, signal?: AbortSignal): Promise<string> {
      if (!(await hasCompanion()))
        return (
          '我理解你想换成「' + query + '」的声音。请先在声音设置连接换声服务，我现在没有改动原声。'
        );
      if (signal?.aborted) throw Error('换声请求已取消');
      const candidate = await resolve(query, signal);
      const reference = await put(
        cid,
        candidate.wav,
        candidate.label,
        candidate.usage === 'reference',
        signal,
      );
      return candidate.usage === 'reference'
        ? `已把「${reference.label}」设成这个角色的参考音色。以后说话会用它。`
        : `找到「${reference.label}」的可播放录音，已保存在这个角色的声音设置里。可以先听；它还没有替换当前声音。`;
    },
    importOwn(cid: string, bytes: Uint8Array, label: string) {
      return put(cid, bytes, label, true);
    },
    async useCandidate(cid: string) {
      const previous = await store.atomic(async (tx) => {
        const settings = await tx.get('settings', cid);
        if (!settings) throw Error('角色不存在');
        const { referenceCandidate, ...voice } = voiceOptions(settings.voice);
        if (!referenceCandidate) throw Error('没有可选的参考声音');
        await tx.put('settings', {
          ...settings,
          voice: { ...voice, referenceVoice: referenceCandidate, enabled: true, playbackSet: true },
        });
        return voice.referenceVoice?.id !== referenceCandidate.id
          ? voice.referenceVoice
          : undefined;
      });
      if (previous) files.remove(previous.id);
    },
    async clearCandidate(cid: string) {
      const candidate = await store.atomic(async (tx) => {
        const settings = await tx.get('settings', cid);
        if (!settings) throw Error('角色不存在');
        const { referenceCandidate, ...voice } = voiceOptions(settings.voice);
        await tx.put('settings', { ...settings, voice });
        return referenceCandidate?.id !== voice.referenceVoice?.id ? referenceCandidate : undefined;
      });
      if (candidate) files.remove(candidate.id);
    },
    async clear(cid: string) {
      const previous = await store.atomic(async (tx) => {
        const settings = await tx.get('settings', cid);
        if (!settings) throw Error('角色不存在');
        const { referenceVoice, ...voice } = voiceOptions(settings.voice);
        await tx.put('settings', { ...settings, voice });
        return referenceVoice && referenceVoice.id !== voice.referenceCandidate?.id
          ? referenceVoice
          : undefined;
      });
      if (previous) files.remove(previous.id);
    },
  };
}
