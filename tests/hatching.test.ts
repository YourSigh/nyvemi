import { it, expect, vi } from 'vitest';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { HatchingService, hatchQuestions } from '../src/characters/hatching';
import { CharacterService } from '../src/characters/service';
import { personaShape } from '../src/characters/persona-shape';
import type { LLMProvider } from '../src/providers/provider';
async function fixture() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const provider: LLMProvider = {
    chat: vi.fn(),
    streamChat: vi.fn(),
    structuredOutput: vi.fn(async (_messages, schema, purpose) =>
      schema.parse(
        purpose === 'persona_generation'
          ? { ...personaShape('x', 'new'), likes: ['音乐'] }
          : purpose === 'hatching_name'
            ? { name: '小悠', acknowledgement: '那就叫我小悠。' }
            : { acknowledgement: '嗯，这个感觉我喜欢。', voiceStyle: 'gentle' },
      ),
    ),
  };
  const characters = new CharacterService(store, async () => provider);
  return {
    store,
    provider,
    characters,
    service: new HatchingService(
      store,
      async () => provider,
      characters,
      async () => {},
    ),
  };
}
it('starts one resumable egg with a real chat question about color and offline voice preference', async () => {
  const { store, service, provider } = await fixture();
  const c = await service.start();
  expect((await service.start()).id).toBe(c.id);
  expect(c.egg).toBe(true);
  expect((await store.list('messages', c.id)).map((m) => m.content).join(' ')).toContain('颜色');
  expect((await store.get('settings', c.id))?.voice).toMatchObject({ enabled: false, rate: 0.92 });
  expect(provider.structuredOutput).not.toHaveBeenCalled();
});
it('keeps one user message across interrupted color changes and resumes without repeating a completed step', async () => {
  const { store, service } = await fixture();
  const c = await service.start();
  const color = vi
    .fn()
    .mockRejectedValueOnce(Error('transition failed'))
    .mockResolvedValue(undefined);
  await expect(service.answer(c.id, '淡蓝色', color)).rejects.toThrow('failed');
  expect((await service.load(c.id))?.pending?.text).toBe('淡蓝色');
  await service.answer(c.id, '淡蓝色', color);
  expect((await store.list('messages', c.id)).filter((m) => m.role === 'user')).toHaveLength(1);
  expect((await service.load(c.id))?.step).toBe(1);
});
it('finishes personality on the same character without replacing messages, then preserves appearance and voice answers', async () => {
  const { store, service } = await fixture();
  const c = await service.start();
  for (const q of hatchQuestions)
    await service.answer(
      c.id,
      q.key === 'appearance' ? '蓝色短发，白色外套' : q.key === 'voice' ? '温柔一点' : '随意一点',
      async () => {},
    );
  const before = (await store.list('messages', c.id)).length;
  const result = await service.finish(c.id);
  expect(result.id).toBe(c.id);
  expect(result.creationActive).toBe(false);
  expect(result.egg).toBe(true);
  expect(result.persona.appearance).toBe('蓝色短发，白色外套');
  expect((await store.list('messages', c.id)).length).toBe(before + 1);
  expect((await service.finish(c.id)).id).toBe(c.id);
  expect((await store.get('settings', c.id))?.voice?.description).toBe('温柔一点');
});
it('uses a local acknowledgement if the optional conversational model fails', async () => {
  const { store, service, provider } = await fixture();
  vi.mocked(provider.structuredOutput).mockRejectedValue(Error('offline'));
  const c = await service.start();
  await service.answer(c.id, '绿色', async () => {});
  expect((await service.load(c.id))?.step).toBe(1);
  expect(
    (await store.list('messages', c.id)).some((m) => m.content === hatchQuestions[1].question),
  ).toBe(true);
});
it('allows a failed color answer to be corrected without duplicating the chat bubble', async () => {
  const { store, service } = await fixture();
  const c = await service.start();
  await expect(
    service.answer(c.id, '说不清的颜色', async () => {
      throw Error('unclear');
    }),
  ).rejects.toThrow('unclear');
  await service.answer(c.id, '淡绿色', async () => {});
  const users = (await store.list('messages', c.id)).filter((m) => m.role === 'user');
  expect(users).toHaveLength(1);
  expect(users[0].content).toBe('淡绿色');
  expect((await service.load(c.id))?.color).toBe('淡绿色');
});
it('delivers each opening bubble after its own typing delay, and keeps the lease until delivery ends', async () => {
  const { store, provider, characters } = await fixture();
  const waits: { ms: number; release: () => void }[] = [];
  const service = new HatchingService(
    store,
    async () => provider,
    characters,
    (ms) => new Promise<void>((release) => waits.push({ ms, release })),
  );
  const c = await service.start();
  const visible = async () =>
    (await store.list('messages', c.id)).filter((m) => m.status === 'complete');
  expect(await visible()).toHaveLength(0);
  const sending = service.resume(c.id);
  await vi.waitFor(() => expect(waits).toHaveLength(1));
  await service.resume(c.id); // cannot run a second delivery concurrently
  expect(waits).toHaveLength(1);
  expect(await visible()).toHaveLength(0);
  waits[0].release();
  await vi.waitFor(() => expect(waits).toHaveLength(2));
  expect(await visible()).toHaveLength(1);
  expect(waits[1].ms).toBeGreaterThan(waits[0].ms);
  waits[1].release();
  await sending;
  expect(await visible()).toHaveLength(2);
  expect((await service.load(c.id))?.outbox).toBeUndefined();
});
it('does not dump queued opening messages during normal chat recovery; resumes only unsent bubbles', async () => {
  const { ChatService } = await import('../src/chat/service');
  const { Diagnostics } = await import('../src/storage/diagnostics');
  const { store, provider, characters, service } = await fixture();
  const c = await service.start();
  await service.resume(c.id);
  const partial = new HatchingService(
    store,
    async () => provider,
    characters,
    vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('paused')),
  );
  await expect(partial.answer(c.id, '蓝色')).rejects.toThrow('paused');
  const d = await service.load(c.id);
  expect(d?.step).toBe(1);
  expect(d?.outbox?.delivered).toBe(1);
  const chat = new ChatService(store, async () => provider, new Diagnostics(store));
  await chat.recoverInterrupted(c.id);
  expect((await chat.history(c.id)).some((m) => m.content === hatchQuestions[1].question)).toBe(
    false,
  );
  const requests = vi.mocked(provider.structuredOutput).mock.calls.length;
  await service.resume(c.id);
  expect(vi.mocked(provider.structuredOutput).mock.calls.length).toBe(requests);
  expect(
    (await chat.history(c.id)).filter((m) => m.content === hatchQuestions[1].question),
  ).toHaveLength(1);
});
it('requires a semantic name result and never saves the raw naming sentence on model failure', async () => {
  const { store, provider, service } = await fixture();
  const c = await service.start();
  await service.answer(c.id, '蓝色');
  vi.mocked(provider.structuredOutput).mockResolvedValueOnce({
    name: '桶砸',
    acknowledgement: '那以后就叫我桶砸。',
  });
  await service.answer(c.id, '叫桶砸吧');
  expect((await store.get('characters', c.id))?.persona.name).toBe('桶砸');
  expect((await service.load(c.id))?.answers.name).toBe('桶砸');
  const other = await fixture(),
    egg = await other.service.start();
  await other.service.answer(egg.id, '绿色');
  vi.mocked(other.provider.structuredOutput).mockRejectedValue(Error('offline'));
  await expect(other.service.answer(egg.id, '叫小夏吧')).rejects.toThrow('还没有改名');
  expect((await other.service.load(egg.id))?.step).toBe(1);
  expect((await other.store.get('characters', egg.id))?.persona.name).toBe('Nyvemi');
  expect((await other.service.load(egg.id))?.pending?.text).toBe('叫小夏吧');
});
it('asks for clarification without advancing when the user only rejects a name', async () => {
  const { store, provider, service } = await fixture();
  const c = await service.start();
  await service.answer(c.id, '蓝色');
  vi.mocked(provider.structuredOutput).mockResolvedValueOnce({
    name: null,
    acknowledgement: '那换一个。',
    clarification: '那你想怎么叫我？',
  });
  await service.answer(c.id, '别叫小小');
  expect((await service.load(c.id))?.step).toBe(1);
  expect((await store.get('characters', c.id))?.persona.name).toBe('Nyvemi');
  await service.answer(c.id, '就叫小悠吧');
  expect((await service.load(c.id))?.step).toBe(2);
  expect((await store.list('messages', c.id)).filter((m) => m.role === 'user')).toHaveLength(3);
});
it('repairs the legacy raw name once using the original utterance and preserves chat history', async () => {
  const { store, provider, service } = await fixture();
  const c = await service.start();
  await service.answer(c.id, '蓝色');
  await service.answer(c.id, '就叫小悠吧');
  const draft = (await service.load(c.id))!,
    character = (await store.get('characters', c.id))!;
  await store.put('hatchings', {
    ...draft,
    nameVersion: undefined,
    answers: { ...draft.answers, name: '就叫小悠吧' },
  });
  await store.put('characters', {
    ...character,
    persona: { ...character.persona, name: '就叫小悠吧' },
  });
  const before = await store.list('messages', c.id);
  await service.repairLegacyName(c.id);
  expect((await store.get('characters', c.id))?.persona.name).toBe('小悠');
  const requests = vi.mocked(provider.structuredOutput).mock.calls.length;
  await service.repairLegacyName(c.id);
  expect(vi.mocked(provider.structuredOutput).mock.calls.length).toBe(requests);
  expect(await store.list('messages', c.id)).toEqual(before);
});
it('accepts absent or null clarification for a confirmed name but requires it when uncertain', async () => {
  const { NameReplySchema } = await import('../src/characters/name');
  expect(
    NameReplySchema.safeParse({ name: '小悠', acknowledgement: '好。', clarification: null })
      .success,
  ).toBe(true);
  expect(
    NameReplySchema.safeParse({ name: null, acknowledgement: '好。', clarification: null }).success,
  ).toBe(false);
});
it('keeps an aborted opening queued and resumes it without an extra model request', async () => {
  const { store, provider, characters, service } = await fixture();
  const c = await service.start();
  const controller = new AbortController();
  const paused = new HatchingService(
    store,
    async () => provider,
    characters,
    async () => {
      controller.abort();
    },
  );
  await expect(paused.resume(c.id, () => {}, controller.signal)).rejects.toThrow('暂停');
  expect((await service.load(c.id))?.outbox?.delivered).toBe(0);
  expect((await store.list('messages', c.id)).every((m) => m.status === 'pending')).toBe(true);
  await service.resume(c.id);
  expect((await service.load(c.id))?.outbox).toBeUndefined();
  expect(provider.structuredOutput).not.toHaveBeenCalled();
});
it('opens in default pink and offers exactly the other three brand themes', () => {
  expect(hatchQuestions[0].choices).toEqual(['月胚 · 淡紫', '薄荷 · 清绿', '星夜 · 深色']);
  expect(hatchQuestions[0].question).toContain('粉白');
});
it('uses Nyvemi before naming and upgrades only an old unnamed placeholder without model calls', async () => {
  const { store, service, provider } = await fixture();
  const c = await service.start();
  expect(c.persona.name).toBe('Nyvemi');
  await store.put('characters', { ...c, persona: { ...c.persona, name: '小小' } });
  await service.load(c.id);
  expect((await store.get('characters', c.id))?.persona.name).toBe('Nyvemi');
  expect(provider.structuredOutput).not.toHaveBeenCalled();
  await store.put('characters', { ...c, persona: { ...c.persona, name: '用户已经改的名字' } });
  await service.load(c.id);
  expect((await store.get('characters', c.id))?.persona.name).toBe('用户已经改的名字');
});
it('preserves 小小 if the user explicitly chose it as the name', async () => {
  const { store, service } = await fixture();
  const c = await service.start();
  const draft = (await service.load(c.id))!;
  await store.put('characters', { ...c, persona: { ...c.persona, name: '小小' } });
  await store.put('hatchings', {
    ...draft,
    step: 2,
    answers: { ...draft.answers, name: '小小' },
    nameVersion: 1,
  });
  await service.load(c.id);
  expect((await store.get('characters', c.id))?.persona.name).toBe('小小');
});
