import { it, expect } from 'vitest';
import { PersonaInterview, interviewQuestions } from '../src/characters/interview';
import { CharacterService } from '../src/characters/service';
import { migrate, SQLiteStore } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona } from '../src/domain/models';
import type { LLMProvider } from '../src/providers/provider';
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  return new SQLiteStore(db);
}
function provider(): LLMProvider {
  return {
    chat: async () => ({ content: '', usage: {} }),
    streamChat: async () => ({ content: '', usage: {} }),
    structuredOutput: async (_, schema, purpose) =>
      schema.parse(
        purpose === 'persona_generation'
          ? demoPersona('remote')
          : { acknowledgement: '这个名字很顺口，记住了。', nextQuestion: '再说说她的样子吧。' },
      ),
  };
}
it('persists a finite interview, resumes after restart and creates one character only after completion', async () => {
  const store = await setup();
  const p = provider();
  let service = new PersonaInterview(
    store,
    async () => p,
    new CharacterService(store, async () => p),
  );
  expect((await service.load()).step).toBe(0);
  await expect(service.finish()).rejects.toThrow('完成访谈');
  await service.answer('小鲸');
  service = new PersonaInterview(store, async () => p, new CharacterService(store, async () => p));
  expect((await service.load()).answers.name).toBe('小鲸');
  expect((await service.load()).step).toBe(1);
  for (let n = 1; n < interviewQuestions.length; n++) await service.answer('由我们慢慢一起决定');
  expect((await service.load()).step).toBe(12);
  expect(await store.list('characters')).toHaveLength(0);
  await service.revise('appearance', '白色卫衣，蓝色发饰的成年女孩');
  const c = await service.finish();
  expect(c.persona.appearance).toContain('白色卫衣');
  expect((await service.finish()).id).toBe(c.id);
  expect(await store.list('characters')).toHaveLength(1);
  await service.clearFinished();
  expect((await service.load()).step).toBe(0);
});
it('allows skipping optional questions, rejects a missing name and avoids endless questioning', async () => {
  const store = await setup();
  const p = provider();
  const service = new PersonaInterview(
    store,
    async () => p,
    new CharacterService(store, async () => p),
  );
  await expect(service.answer('', true)).rejects.toThrow('起个名字');
  await expect(service.answer('')).rejects.toThrow('有效答案');
  await service.answer('鲸');
  for (let n = 1; n < 12; n++) await service.answer('', true);
  const done = await service.answer('extra');
  expect(done.step).toBe(12);
  expect(done.turns).toHaveLength(25);
});
it('falls back to labeled local encouragement when the provider fails without losing progress', async () => {
  const store = await setup();
  const p = {
    ...provider(),
    structuredOutput: async () => {
      throw new Error('offline');
    },
  };
  const service = new PersonaInterview(
    store,
    async () => p,
    new CharacterService(store, async () => p),
  );
  const draft = await service.answer('小鲸');
  expect(draft.step).toBe(1);
  expect(draft.turns.at(-1)?.localFallback).toBe(true);
  expect(draft.answers.name).toBe('小鲸');
});
it('prevents double taps from paying for the same interview answer twice', async () => {
  const store = await setup();
  let calls = 0;
  let finish!: () => void;
  const p: LLMProvider = {
    ...provider(),
    structuredOutput: async (_, schema) => {
      calls++;
      await new Promise<void>((r) => {
        finish = r;
      });
      return schema.parse({ acknowledgement: '记住了', nextQuestion: '样子呢？' });
    },
  };
  const service = new PersonaInterview(
    store,
    async () => p,
    new CharacterService(store, async () => p),
  );
  await service.load();
  const first = service.answer('小鲸');
  await expect(service.answer('重复')).rejects.toThrow('整理');
  while (!finish) await new Promise((r) => setTimeout(r, 0));
  finish();
  await first;
  expect(calls).toBe(1);
});
