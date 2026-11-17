import type { VoiceReference } from '../src/domain/models';
import { expect, it, vi } from 'vitest';
import { CharacterService, defaultAnswers } from '../src/characters/service';
import { ChatService } from '../src/chat/service';
import { requestedVoiceReference } from '../src/chat/voice-settings';
import { Diagnostics } from '../src/storage/diagnostics';
import { migrate, SQLiteStore } from '../src/storage/store';
import { createReferenceVoiceService } from '../src/speech/reference-service';
import { TestDatabase } from './database';

it('extracts a role only from explicit current-character change requests', () => {
  expect(requestedVoiceReference('我希望你的声音跟流萤一样。')).toBe('流萤');
  expect(requestedVoiceReference('把你的声音换成原神纳西妲的声音')).toBe('原神纳西妲');
  expect(requestedVoiceReference('以后用卡芙卡的声音回复')).toBe('卡芙卡');
  for (const input of [
    '不要换成流萤的声音',
    '如果你的声音跟流萤一样',
    '让我的声音跟流萤一样',
    '我喜欢流萤的声音',
    '把你的声音换成更温柔的声音',
  ])
    expect(requestedVoiceReference(input)).toBeUndefined();
});

async function fixture() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const provider = vi.fn(async () => {
    throw Error('不能调用聊天模型');
  });
  const character = await new CharacterService(store, provider).create(
    { ...defaultAnswers, name: '本机测试' },
    true,
  );
  let ordinal = 0;
  const remove = vi.fn();
  const save = vi.fn((_wav: Uint8Array, label: string, metadata?: Partial<VoiceReference>) => ({
    ...metadata,
    id: `12345678-0000-0000-0000-${String(++ordinal).padStart(12, '0')}`,
    label,
  }));
  return { store, character, provider, remove, save };
}

it('chat saves a public recording as candidate and never activates or reads chat provider', async () => {
  const f = await fixture();
  const send = vi.fn(async () => ({
    label: '流萤试听',
    wav: new Uint8Array([1]),
    usage: 'preview' as const,
  }));
  const service = createReferenceVoiceService(
    f.store,
    { save: f.save, remove: f.remove },
    send,
    async () => true,
  );
  const chat = new ChatService(f.store, f.provider, new Diagnostics(f.store), {
    requestVoiceReference: service.request,
    retrieve: async () => [],
    afterRound: async () => {},
  });
  await chat.send(f.character.id, '我希望你的声音跟流萤一样。', () => {});
  expect(f.provider).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith('流萤', undefined);
  const history = await chat.history(f.character.id);
  expect(history.at(-1)).toMatchObject({ voiceSettings: true, status: 'complete' });
  expect(history.at(-1)?.content).toContain('还没有替换');
  const stored = (await f.store.get('settings', f.character.id))?.voice;
  expect(stored?.referenceCandidate?.label).toBe('流萤试听');
  expect(stored?.referenceVoice).toBeUndefined();
  await service.useCandidate(f.character.id);
  const active = (await f.store.get('settings', f.character.id))?.voice;
  expect(active?.referenceVoice?.label).toBe('流萤试听');
  expect(active?.referenceCandidate).toBeUndefined();
  expect(active?.enabled).toBe(true);
});
it('a trusted prepared reference can activate, abort keeps the saved voice and clearing restores local mode', async () => {
  const f = await fixture(),
    response = vi.fn(async () => ({
      label: '我获准的录音',
      wav: new Uint8Array([1]),
      usage: 'reference' as const,
    }));
  const service = createReferenceVoiceService(
    f.store,
    { save: f.save, remove: f.remove },
    response,
    async () => true,
  );
  await service.request(f.character.id, '示例人物');
  const ref = (await f.store.get('settings', f.character.id))?.voice?.referenceVoice;
  expect(ref?.label).toBe('我获准的录音');
  const controller = new AbortController();
  controller.abort();
  await expect(service.request(f.character.id, '新的参考', controller.signal)).rejects.toThrow(
    '已取消',
  );
  expect(response).toHaveBeenCalledOnce();
  expect((await f.store.get('settings', f.character.id))?.voice?.referenceVoice).toEqual(ref);
  await service.clear(f.character.id);
  expect((await f.store.get('settings', f.character.id))?.voice?.referenceVoice).toBeUndefined();
  expect(f.remove).toHaveBeenCalledWith(ref?.id);
});

it('stages exact source metadata, rejects stale selection, and persists affirmative use of same file', async () => {
  const f = await fixture();
  const service = createReferenceVoiceService(
    f.store,
    { save: f.save, remove: f.remove },
    vi.fn(),
    async () => false,
  );
  const metadata = {
    query: '流萤',
    label: '流萤 中文自我介绍',
    sourceUrl: 'https://wiki.example/firefly',
    audioUrl: 'https://audio.example/firefly.wav',
    language: 'zh' as const,
    usage: 'preview' as const,
  };
  const selected = await service.stageCandidate(
    f.character.id,
    new Uint8Array([1, 2, 3]),
    metadata,
  );
  expect((await f.store.get('settings', f.character.id))?.voice?.referenceVoice).toBeUndefined();
  await expect(service.useCandidate(f.character.id, 'stale')).rejects.toThrow('已改变');
  expect((await f.store.get('settings', f.character.id))?.voice?.referenceVoice).toBeUndefined();
  await service.useCandidate(f.character.id, selected.id);
  const applied = (await f.store.get('settings', f.character.id))?.voice?.referenceVoice;
  expect(applied).toEqual({ ...metadata, id: selected.id, authorizedByUser: true });
  expect(f.save).toHaveBeenCalledOnce();
  expect(f.remove).not.toHaveBeenCalled();
});
