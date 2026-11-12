import { expect, it, vi } from 'vitest';
import { localSpeechDriver } from '../src/speech/native';
import { voiceProfile } from '../src/speech/preferences';

const native = vi.hoisted(() => ({
  speakQwen: vi.fn(),
  speakLocal: vi.fn(async () => true),
}));
vi.mock('../src/native/android', () => ({ bridge: () => native }));

it('reads with the system voice until Qwen is installed, then uses the selected Qwen voice', async () => {
  const voice = {
    ...voiceProfile(),
    voiceId: 'qwen:vivian',
    fallbackVoiceId: 'android-zh-offline',
  };
  native.speakQwen
    .mockRejectedValueOnce(Error('qwen_voice_unavailable'))
    .mockResolvedValueOnce(true);
  expect(await localSpeechDriver.play('before', '你好', voice)).toBe(true);
  expect(native.speakLocal).toHaveBeenCalledWith(
    'before',
    '你好',
    'android-zh-offline',
    voice.rate,
    voice.pitch,
  );
  expect(await localSpeechDriver.play('after', '你好', voice)).toBe(true);
  expect(native.speakQwen).toHaveBeenLastCalledWith('after', '你好', 'vivian', 1, 1, 1);
  expect(native.speakLocal).toHaveBeenCalledTimes(1);
});
