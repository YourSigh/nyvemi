import { bridge } from '../native/android';
import type { SpeechDriver } from './queue';
export const localSpeechDriver: SpeechDriver = {
  play: (id, text, options) =>
    bridge().speakLocal(id, text, options.voiceId ?? null, options.rate, options.pitch),
  stop: () => bridge().stopSpeech(),
};
