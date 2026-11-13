import { bridge } from '../native/android';
import { qwenSpeaker, qwenTuning, type VoiceOptions } from './preferences';
import type { SpeechDriver } from './queue';

let playbackEpoch = 0;
export const localSpeechDriver: SpeechDriver = {
  async play(id, text, options) {
    const native = bridge();
    const speaker = qwenSpeaker(options);
    if (speaker) {
      const epoch = playbackEpoch;
      try {
        const { rate, pitch, volume } = qwenTuning(options, speaker);
        return await native.speakQwen(id, text, speaker, rate, pitch, volume);
      } catch {
        if (epoch !== playbackEpoch) return false;
      }
    }
    const voiceId = speaker ? options.fallbackVoiceId : options.voiceId;
    return native.speakLocal(
      id,
      text,
      voiceId === 'system:default' ? null : (voiceId ?? null),
      options.rate,
      options.pitch,
    );
  },
  prepare: (id, text, options) => {
    const speaker = qwenSpeaker(options);
    return speaker
      ? bridge().prepareQwenSpeech(id, text, speaker, qwenTuning(options, speaker).rate)
      : undefined;
  },
  stop() {
    playbackEpoch++;
    return bridge().stopSpeech();
  },
  release() {
    playbackEpoch++;
    return bridge().releaseQwenVoice();
  },
};

export function warmLocalSpeech(options: VoiceOptions): void {
  if (options.enabled && qwenSpeaker(options))
    void bridge()
      .warmQwenVoice()
      .catch(() => {});
}
