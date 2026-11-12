import { bridge } from '../native/android';
import { qwenSpeaker, type VoiceOptions } from './preferences';
import type { SpeechDriver } from './queue';

let playbackEpoch = 0;
export const localSpeechDriver: SpeechDriver = {
  async play(id, text, options) {
    const native = bridge();
    const speaker = qwenSpeaker(options);
    if (speaker) {
      const epoch = playbackEpoch;
      try {
        return await native.speakQwen(id, text, speaker);
      } catch {
        if (epoch !== playbackEpoch) return false;
      }
    }
    const voiceId =
      speaker || options.voiceId === 'system:default' ? null : (options.voiceId ?? null);
    return native.speakLocal(id, text, voiceId, options.rate, options.pitch);
  },
  prepare: (id, text, options) => {
    const speaker = qwenSpeaker(options);
    return speaker ? bridge().prepareQwenSpeech(id, text, speaker) : undefined;
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
