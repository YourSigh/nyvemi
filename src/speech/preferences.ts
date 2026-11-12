import type { Settings } from '../domain/models';
import type { Storage } from '../storage/store';

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

export function updateVoice(store: Storage, cid: string, patch: Partial<VoiceOptions>) {
  return store.atomic(async (tx) => {
    const settings = await tx.get('settings', cid);
    if (!settings) throw Error('角色不存在');
    const voice = { ...voiceOptions(settings.voice), ...patch };
    await tx.put('settings', { ...settings, voice });
    return voice;
  });
}

export const qwenVoices = [
  { id: 'serena', label: 'Serena · 温柔女声' },
  { id: 'vivian', label: 'Vivian · 清亮女声' },
  { id: 'uncle_fu', label: 'Uncle Fu · 沉稳男声' },
  { id: 'dylan', label: 'Dylan · 北京男声' },
  { id: 'eric', label: 'Eric · 四川男声' },
  { id: 'ryan', label: 'Ryan · 英语男声' },
  { id: 'aiden', label: 'Aiden · 英语男声' },
  { id: 'ono_anna', label: 'Ono Anna · 日语女声' },
  { id: 'sohee', label: 'Sohee · 韩语女声' },
] as const;

export function qwenSpeaker(options: VoiceOptions): string | undefined {
  const voice = options.voiceId;
  if (!voice || voice.startsWith('kokoro:')) return 'serena';
  if (!voice.startsWith('qwen:')) return undefined;
  return qwenVoices.find(({ id }) => voice === `qwen:${id}`)?.id ?? 'serena';
}
