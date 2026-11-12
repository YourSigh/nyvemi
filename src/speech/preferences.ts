import type { Settings } from '../domain/models';
import type { Storage } from '../storage/store';
import {
  originalQwenSound,
  QwenSpeakerSchema,
  type QwenSpeaker,
  type QwenTuning,
} from '../domain/qwen-voice';

export type VoiceOptions = NonNullable<Settings['voice']>;

export const voiceProfile = (style = 'gentle'): VoiceOptions => ({
  enabled: false,
  rate: style === 'bright' ? 1.05 : style === 'low' ? 0.85 : 0.92,
  pitch: style === 'low' ? 0.85 : style === 'calm' ? 1 : style === 'bright' ? 1.17 : 1.08,
});

export function voiceOptions(voice: Settings['voice']): VoiceOptions {
  if (!voice) return voiceProfile();
  // Older versions enabled speech automatically while creating a character.
  return {
    ...voice,
    enabled: voice.playbackSet === true && voice.enabled,
    voiceId: voice.voiceId?.startsWith('kokoro:') ? undefined : voice.voiceId,
  };
}

export function updateVoice(
  store: Storage,
  cid: string,
  patch: Partial<VoiceOptions> | ((voice: VoiceOptions) => Partial<VoiceOptions>),
) {
  return store.atomic(async (tx) => {
    const settings = await tx.get('settings', cid);
    if (!settings) throw Error('角色不存在');
    const current = voiceOptions(settings.voice);
    const voice = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
    await tx.put('settings', { ...settings, voice });
    return voice;
  });
}

const qwenVoiceLabels: Record<QwenSpeaker, string> = {
  serena: 'Serena · 温柔女声',
  vivian: 'Vivian · 清亮女声',
  uncle_fu: 'Uncle Fu · 沉稳男声',
  dylan: 'Dylan · 北京男声',
  eric: 'Eric · 四川男声',
  ryan: 'Ryan · 英语男声',
  aiden: 'Aiden · 英语男声',
  ono_anna: 'Ono Anna · 日语女声',
  sohee: 'Sohee · 韩语女声',
};

export const qwenVoices = QwenSpeakerSchema.options.map((id) => ({
  id,
  label: qwenVoiceLabels[id],
}));

export function qwenSpeaker(options: VoiceOptions): QwenSpeaker | undefined {
  const voice = options.voiceId;
  if (!voice || voice.startsWith('kokoro:')) return 'serena';
  if (!voice.startsWith('qwen:')) return undefined;
  const speaker = QwenSpeakerSchema.safeParse(voice.slice('qwen:'.length));
  return speaker.success ? speaker.data : 'serena';
}

export function qwenTuning(options: VoiceOptions, speaker: QwenSpeaker): QwenTuning {
  return options.qwenTuning?.[speaker] ?? originalQwenSound;
}

export function updateQwenTuning(
  store: Storage,
  cid: string,
  speaker: QwenSpeaker,
  tuning: QwenTuning,
) {
  return updateVoice(store, cid, (voice) => ({
    qwenTuning: { ...voice.qwenTuning, [speaker]: tuning },
  }));
}

export function preferQwenVoice(store: Storage, cid: string) {
  return updateVoice(store, cid, (voice) => {
    if (qwenSpeaker(voice)) return {};
    return { voiceId: 'qwen:serena', fallbackVoiceId: voice.voiceId };
  });
}
