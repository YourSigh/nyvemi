import { expect, it, vi } from 'vitest';
import { ChatService } from '../src/chat/service';
import { wantsVoiceSettings } from '../src/chat/voice-settings';
import { defaultSettings, MessageSchema } from '../src/domain/models';
import { preferQwenVoice, qwenSpeaker, updateVoice } from '../src/speech/preferences';
import { Diagnostics } from '../src/storage/diagnostics';
import { migrate, SQLiteStore } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona } from './persona-fixture';

it('recognizes differently worded voice requests and leaves ordinary voice talk alone', () => {
  for (const text of [
    '我想改一下你的声音',
    '可以换个音色吗',
    '你的声线能不能换',
    '帮我下载离线语音包',
    'Can I adjust your voice?',
  ])
    expect(wantsVoiceSettings(text)).toBe(true);
  for (const text of ['你的声音很好听', '不想换你的声音', '我的声音怎么换', '先别下载语音包'])
    expect(wantsVoiceSettings(text)).toBe(false);
});

it('saves an actionable chat bubble without requiring a chat API', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 0.5, relationshipCloseness: 0.5, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  });
  const provider = vi.fn(async () => {
    throw Error('offline');
  });
  const chat = new ChatService(store, provider, new Diagnostics(store));
  await chat.send('c', '想改一下你的声音', () => {});
  const [user, card] = (await chat.history('c')).map((message) => MessageSchema.parse(message));
  expect(user).toMatchObject({ role: 'user', status: 'complete' });
  expect(card).toMatchObject({ groupId: user.id, role: 'assistant', voiceSettings: true });
  expect(provider).not.toHaveBeenCalled();
});

it('switches to Qwen when requested and preserves the prior system voice as fallback', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('settings', defaultSettings('c'));
  await updateVoice(store, 'c', {
    voiceId: 'android-zh-offline',
    enabled: true,
    playbackSet: true,
  });
  const voice = await preferQwenVoice(store, 'c');
  expect(qwenSpeaker(voice)).toBe('serena');
  expect(voice).toMatchObject({ fallbackVoiceId: 'android-zh-offline', enabled: true });
});
