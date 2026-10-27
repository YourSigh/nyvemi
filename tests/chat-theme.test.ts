import { expect, it } from 'vitest';
import { isThemeChangeRequest } from '../src/theme/chat-request';
import { ChatService } from '../src/chat/service';
import { parseChatOutcome } from '../src/chat/outcome';
import { CharacterService, defaultAnswers } from '../src/characters/service';
import { demoPersona } from '../src/domain/models';
import { Diagnostics } from '../src/storage/diagnostics';
import type { LLMProvider } from '../src/providers/provider';
import { migrate, SQLiteStore } from '../src/storage/store';
import { TestDatabase } from './database';
it('accepts personal color preferences and interface requests while excluding quotes and unrelated objects', () => {
  for (const input of [
    '把这里换成淡紫色吧',
    '帮我把主题调暗一点',
    '换个淡蓝色吧',
    '调暗一点',
    'change the theme to blue',
    '我喜欢紫色',
    '我最喜欢淡蓝色，别太艳',
    '还是蓝灰色看着更舒服',
    'I prefer soft pink',
    '淡紫色也挺好看',
    '喜欢薄荷绿色',
  ])
    expect(isThemeChangeRequest(input)).toBe(true);
  for (const input of [
    '我喜欢红烧肉',
    '我喜欢蓝色吗？',
    '我喜欢蓝色的杯子',
    '我朋友喜欢蓝色',
    '我喜欢蓝色的衣服',
    '我喜欢粉色，但别换',
    '你喜欢什么颜色？',
    '别换成蓝色',
    '如果换成蓝色会怎么样',
    '换成蓝色的裙子',
    '他说“换成蓝色”是什么意思',
  ])
    expect(isThemeChangeRequest(input)).toBe(false);
});
async function fixture() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  let action = true;
  const prompts: string[] = [];
  const provider: LLMProvider = {
    chat: async () => {
      throw new Error('unused');
    },
    structuredOutput: async (_, schema) => schema.parse(demoPersona('c')),
    streamChat: async (turns) => {
      prompts.push(turns[0].content);
      return {
        content: JSON.stringify({
          messages: ['好，淡一点的紫。'],
          theme: action ? { description: '淡紫色，柔和一点' } : null,
        }),
        usage: {},
      };
    },
  };
  const character = await new CharacterService(store, async () => provider).create(
    { ...defaultAnswers, name: '桶砸' },
    true,
    'c',
  );
  const chat = new ChatService(
    store,
    async () => provider,
    new Diagnostics(store),
    undefined,
    async () => {},
  );
  return {
    store,
    chat,
    character,
    prompts,
    disableAction: () => {
      action = false;
    },
  };
}
it('applies a semantic theme action during chat without opening another questionnaire', async () => {
  const { chat, store, prompts } = await fixture();
  const applied: string[] = [];
  await chat.send(
    'c',
    '把这里换成淡紫色吧',
    () => {},
    undefined,
    undefined,
    undefined,
    async (description) => {
      applied.push(description);
    },
  );
  expect(applied).toEqual(['淡紫色，柔和一点']);
  expect(prompts[0]).toContain('这轮允许响应界面');
  expect((await chat.history('c')).map((m) => m.content)).toEqual([
    '把这里换成淡紫色吧',
    '好，淡一点的紫。',
  ]);
  expect(await store.list('intentions', 'c')).toHaveLength(0);
});
it('rejects unsolicited theme actions on questions about someone else', async () => {
  const { chat, disableAction } = await fixture();
  let applied = false;
  await expect(
    chat.send(
      'c',
      '你喜欢什么颜色？',
      () => {},
      undefined,
      undefined,
      undefined,
      async () => {
        applied = true;
      },
    ),
  ).rejects.toThrow('未明确要求');
  expect(applied).toBe(false);
  disableAction();
  await chat.send('c', '你今天想聊什么', () => {});
  expect(applied).toBe(false);
});
it('does not duplicate an already delivered chat reply when the visual change fails', async () => {
  const { chat } = await fixture();
  await expect(
    chat.send(
      'c',
      '换个淡紫色吧',
      () => {},
      undefined,
      undefined,
      undefined,
      async () => {
        throw new Error('capture failed');
      },
    ),
  ).rejects.toThrow('capture failed');
  const messages = await chat.history('c');
  expect(messages).toHaveLength(2);
  expect(messages.every((m) => m.status === 'complete')).toBe(true);
  expect(
    parseChatOutcome('{"messages":[],"theme":{"description":"淡紫色"}}').theme?.description,
  ).toBe('淡紫色');
});

it('executes a clear color request even when the provider omits its action field', async () => {
  const { chat, disableAction } = await fixture();
  disableAction();
  const applied: string[] = [];
  await chat.send(
    'c',
    '换成淡蓝色吧',
    () => {},
    undefined,
    undefined,
    undefined,
    async (description) => {
      applied.push(description);
    },
  );
  expect(applied).toEqual(['换成淡蓝色吧']);
  expect(() =>
    parseChatOutcome(
      '{"messages":[],"theme":{"description":"蓝色"},"schedule":{"afterSeconds":60}}',
    ),
  ).toThrow();
});

it('applies a personal color preference even when the optional model action is absent', async () => {
  const { chat, disableAction } = await fixture();
  disableAction();
  const applied: string[] = [];
  await chat.send(
    'c',
    '我喜欢淡蓝色',
    () => {},
    undefined,
    undefined,
    undefined,
    async (description) => {
      applied.push(description);
    },
  );
  expect(applied).toEqual(['我喜欢淡蓝色']);
});
