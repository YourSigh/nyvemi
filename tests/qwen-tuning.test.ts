import { expect, it } from 'vitest';
import { defaultSettings, SettingsSchema } from '../src/domain/models';
import { originalQwenSound, QwenTuningSchema } from '../src/domain/qwen-voice';
import { qwenTuning, updateQwenTuning, updateVoice, voiceOptions } from '../src/speech/preferences';
import { migrate, SQLiteStore } from '../src/storage/store';
import { TestDatabase } from './database';

it('keeps Qwen at its original sound for older settings', () => {
  const settings = SettingsSchema.parse({
    ...defaultSettings('c'),
    voice: { enabled: false, rate: 0.92, pitch: 1.08 },
  });
  expect(qwenTuning(voiceOptions(settings.voice), 'serena')).toEqual(originalQwenSound);
  expect(QwenTuningSchema.safeParse({ rate: 1.25, pitch: 1, volume: 1 }).success).toBe(false);
});

it('persists each preset separately without changing system voice preferences', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('settings', defaultSettings('c'));
  const serena = { rate: 0.9, pitch: 1.05, volume: 0.8 };
  const vivian = { rate: 1.1, pitch: 0.95, volume: 0.65 };
  await updateVoice(store, 'c', { enabled: true, playbackSet: true, rate: 0.85, pitch: 1.08 });
  await updateQwenTuning(store, 'c', 'serena', serena);
  await updateVoice(store, 'c', { voiceId: 'qwen:vivian' });
  await updateQwenTuning(store, 'c', 'vivian', vivian);
  let voice = voiceOptions(SettingsSchema.parse(await store.get('settings', 'c')).voice);
  expect(qwenTuning(voice, 'serena')).toEqual(serena);
  expect(qwenTuning(voice, 'vivian')).toEqual(vivian);
  expect(qwenTuning(voice, 'sohee')).toEqual(originalQwenSound);
  await updateQwenTuning(store, 'c', 'serena', originalQwenSound);
  voice = voiceOptions(SettingsSchema.parse(await store.get('settings', 'c')).voice);
  expect(voice).toMatchObject({ voiceId: 'qwen:vivian', rate: 0.85, pitch: 1.08, enabled: true });
  expect(qwenTuning(voice, 'vivian')).toEqual(vivian);
  expect(qwenTuning(voice, 'serena')).toEqual(originalQwenSound);
});
