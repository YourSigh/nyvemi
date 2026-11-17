import { expect, it, vi } from 'vitest';
import {
  requestedVoiceReference,
  wantsVoiceSettings,
  contextualVoiceReference,
  voiceSettingsMessage,
} from '../src/chat/voice-settings';
import { createLocalVoiceRequest } from '../src/speech/local-voice-request';
import type { Message } from '../src/domain/models';
it('recognizes simple requested voice but not admiration, negation or hypothetical', () => {
  for (const text of ['想要流萤的声音', '我想要流萤的声音。', '想用卡芙卡的声线']) {
    expect(requestedVoiceReference(text)).toBeTruthy();
    expect(wantsVoiceSettings(text)).toBe(true);
  }
  for (const text of [
    '我喜欢流萤的声音',
    '不想要流萤的声音',
    '假如我想要流萤的声音',
    '想要更温柔的声音',
  ])
    expect(requestedVoiceReference(text)).toBeUndefined();
});
it('missing model request does not search until preparation', async () => {
  const deps = { state: vi.fn(async () => ({ available: false })), find: vi.fn() };
  expect(await createLocalVoiceRequest(deps)('c', '流萤')).toContain('现在没有开始下载');
  expect(deps.find).not.toHaveBeenCalled();
});
it('ready model searches only the extracted requested role exactly once', async () => {
  const deps = {
    state: vi.fn(async () => ({ available: true })),
    find: vi.fn(async () => ({ candidates: [] })),
  };
  await createLocalVoiceRequest(deps)('c', '流萤');
  expect(deps.find).toHaveBeenCalledExactlyOnceWith('c', '流萤');
});
it('same already-applied query avoids repeat lookup', async () => {
  const deps = {
    state: vi.fn(async () => ({ available: true, enabled: true })),
    find: vi.fn(),
    appliedQuery: async () => '卡芙卡',
  };
  expect(await createLocalVoiceRequest(deps)('c', '卡芙卡')).toContain('已应用');
  expect(deps.find).not.toHaveBeenCalled();
});

it.each(['你重新试试能不能找到崩铁流萤的声音，然后给我换上', '我想要你的声音改成崩铁流萤的音色'])(
  'extracts exact role from owner utterance: %s',
  (text) => {
    expect(requestedVoiceReference(text)).toBe('崩铁流萤');
    expect(wantsVoiceSettings(text)).toBe(true);
  },
);
it('contextual correction uses only an immediate unresolved exact role', () => {
  const user: Message = {
    id: 'u',
    characterId: 'c',
    role: 'user',
    content: '我想要你的声音改成崩铁流萤的音色',
    origin: 'chat',
    status: 'complete',
    createdAt: Date.now() - 100,
  };
  const card = voiceSettingsMessage(user, '请点击下载', '崩铁流萤');
  expect(contextualVoiceReference('不是你帮我扒一个用吗', [user, card])).toBe('崩铁流萤');
  expect(contextualVoiceReference('不是你帮我扒一个用吗', [])).toBeUndefined();
  expect(
    contextualVoiceReference('不是你帮我扒一个用吗', [
      user,
      card,
      { ...user, id: 'other', content: '今天吃什么', createdAt: Date.now() + 10 },
    ]),
  ).toBeUndefined();
  expect(
    contextualVoiceReference('不是你帮我扒一个用吗', [user, { ...card, content: '已应用' }]),
  ).toBeUndefined();
});
