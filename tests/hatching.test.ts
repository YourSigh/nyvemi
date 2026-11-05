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
          : { acknowledgement: '嗯，这个感觉我喜欢。', answer: '小悠', voiceStyle: 'gentle' },
      ),
    ),
  };
  const characters = new CharacterService(store, async () => provider);
  return { store, provider, service: new HatchingService(store, async () => provider, characters) };
}
it('starts one resumable egg with a real chat question about color and offline voice preference', async () => {
  const { store, service, provider } = await fixture();
  const c = await service.start();
  expect((await service.start()).id).toBe(c.id);
  expect(c.egg).toBe(true);
  expect((await store.list('messages', c.id)).map((m) => m.content).join(' ')).toContain('颜色');
  expect((await store.get('settings', c.id))?.voice).toMatchObject({ enabled: true, rate: 0.92 });
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
