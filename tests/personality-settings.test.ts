import { expect, it, vi } from 'vitest';
import { agentSystem } from '../src/agent/prompt';
import { CompanionAgent, type AgentHost } from '../src/agent/service';
import type { AgentModelRequest } from '../src/agent/core';
import { buildChatPrompt, characterVoice } from '../src/chat/prompt';
import { personalityDraft, updatePersonality } from '../src/characters/personality';
import { defaultAnswers, CharacterService } from '../src/characters/service';
import {
  defaultSettings,
  maxPersonalityNoteLength,
  type Character,
  type Message,
} from '../src/domain/models';
import type { LLMProvider } from '../src/providers/provider';
import { SQLiteStore, migrate } from '../src/storage/store';
import { Diagnostics } from '../src/storage/diagnostics';
import { CharacterBundleService } from '../src/transfer/bundle';
import { TestDatabase } from './database';
import { demoPersona } from './persona-fixture';
import { hatchQuestions, type HatchingDraft } from '../src/characters/hatching';

async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const character: Character = {
    id: 'c',
    persona: demoPersona('c'),
    avatar: 'file:///avatar.png',
    state: {
      energy: 0.7,
      relationshipCloseness: 0.5,
      recentFocus: ['最近在做的事'],
      curiosityTopics: ['游戏'],
    },
    interests: [{ topic: '游戏', score: 0.8, source: 'experience', updatedAt: 1 }],
    createdAt: 1,
  };
  await store.put('characters', character);
  await store.put('settings', defaultSettings(character.id));
  return { store, character, draft: personalityDraft(character.persona) };
}

it('persists owner settings without removing appearance, memories, or learned traits', async () => {
  const { store, character, draft } = await setup();
  await store.put('memories', {
    id: 'memory',
    characterId: character.id,
    type: 'relationship',
    content: '两人聊过独立游戏。',
    importance: 0.8,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
  });
  const learned = ['偶尔问问进度', '不要催回复'];
  await store.put('characters', {
    ...character,
    persona: { ...character.persona, responsePreferences: learned },
  });
  const saved = await updatePersonality(store, character.id, {
    ...draft,
    name: '  小岚  ',
    speech: '  别老把话说满，接梗就好  ',
  });
  expect(await store.get('characters', character.id)).toEqual(saved);
  expect(saved).toEqual({
    ...character,
    persona: {
      ...character.persona,
      name: '小岚',
      responsePreferences: learned,
      userSteering: { speech: '别老把话说满，接梗就好' },
    },
  });
  expect(await store.get('memories', 'memory')).toMatchObject({ content: '两人聊过独立游戏。' });
  expect(await store.get('settings', character.id)).toBeDefined();
});

it('allows a field to return to the original setting and saves completed onboarding names', async () => {
  const { store, character, draft } = await setup();
  const opening: HatchingDraft = {
    id: character.id,
    characterId: character.id,
    createdAt: 1,
    step: hatchQuestions.length,
    status: 'complete',
    answers: { ...defaultAnswers, name: character.persona.name },
  };
  await store.put('hatchings', opening);
  const saved = await updatePersonality(store, character.id, {
    ...draft,
    name: '小岚',
    relationship: '自然一点的同事',
    boundaries: '别用昵称',
  });
  expect(await store.get('hatchings', character.id)).toMatchObject({
    nameVersion: 1,
    answers: { name: '小岚' },
  });
  const reset = await updatePersonality(store, character.id, {
    ...personalityDraft(saved.persona),
    boundaries: '  ',
  });
  expect(reset.persona.userSteering).toEqual({ relationship: '自然一点的同事' });
  expect(
    (await updatePersonality(store, character.id, { ...draft, name: '小岚' })).persona.userSteering,
  ).toBeUndefined();
  expect((await store.get('characters', character.id))?.persona.responsePreferences).toEqual(
    character.persona.responsePreferences,
  );
});

it('validates input and leaves in-progress character creation untouched', async () => {
  const { store, character, draft } = await setup();
  await expect(updatePersonality(store, character.id, { ...draft, name: ' ' })).rejects.toThrow();
  await expect(
    updatePersonality(store, character.id, {
      ...draft,
      speech: '长'.repeat(maxPersonalityNoteLength + 1),
    }),
  ).rejects.toThrow();
  await store.put('characters', { ...character, egg: true, creationActive: true });
  await expect(updatePersonality(store, character.id, { ...draft, name: '小岚' })).rejects.toThrow(
    '开场',
  );
  expect((await store.get('characters', character.id))?.persona.name).toBe(character.persona.name);
});

it('applies current owner settings to DSH and legacy chat alongside evolving feedback', async () => {
  const { store, character, draft } = await setup();
  const saved = await updatePersonality(store, character.id, {
    ...draft,
    name: '小岚',
    personality: '温柔但很有主见',
    speech: '想清楚再答，有些话可以分开发',
    relationship: '像熟悉的搭子',
    boundaries: '别叫我小朋友',
  });
  const prompts = [
    agentSystem(saved, [], [], '设备时间', ''),
    buildChatPrompt(saved, [], [])[0].content,
  ];
  for (const prompt of prompts) {
    expect(prompt).toContain('你现在的名字是"小岚"');
    expect(prompt).toContain('别叫我小朋友');
    expect(prompt).toContain('像熟悉的搭子');
    expect(prompt).toContain('优先采用此处设定');
    expect(prompt).toContain('吐槽时先接话');
    expect(prompt).toContain('语气样本');
    expect(prompt.indexOf('想清楚再答，有些话可以分开发')).toBeLessThan(
      prompt.indexOf('吐槽时先接话'),
    );
  }
  expect(characterVoice(character.persona)).not.toContain('用户亲自保存');
});

it('uses edits on the next real embedded DSH turn without discarding the session', async () => {
  const { store, character, draft } = await setup();
  const requests: AgentModelRequest[] = [];
  const toolChat: NonNullable<LLMProvider['toolChat']> = async (request) => {
    requests.push(request);
    return { content: '', toolCalls: [], usage: {} };
  };
  const host: AgentHost = {
    web: {
      search: async () => [],
      read: async () => {
        throw Error('offline');
      },
      bilibili: async () => [],
    },
    notifications: { enabled: async () => false, show: async () => {}, cancel: async () => {} },
    visible: () => true,
    clock: () => '设备时间',
    model: async () => 'mock',
    schedule: async () => {},
    redact: async (value) => value,
  };
  const agent = new CompanionAgent(
    store,
    async () => ({ toolChat }) as LLMProvider,
    new Diagnostics(store),
    host,
  );
  const user: Message = {
    id: 'turn-one',
    characterId: character.id,
    role: 'user',
    content: '今天看到一个小游戏。',
    createdAt: Date.now(),
    origin: 'chat',
    status: 'complete',
  };
  await agent.run({ characterId: character.id, user });
  const previous = await store.get('agentSessions', character.id);
  await updatePersonality(store, character.id, { ...draft, speech: '语气像在发私信，少用感叹号' });
  await agent.run({
    characterId: character.id,
    user: { ...user, id: 'turn-two', content: '你觉得怎么样？' },
  });
  const next = await store.get('agentSessions', character.id);
  expect(next?.sessionId).toBe(previous?.sessionId);
  expect(next?.events.length).toBeGreaterThan(previous?.events.length ?? 0);
  expect(JSON.stringify(requests[0].messages)).not.toContain('少用感叹号');
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain('少用感叹号');
});

it('does not let onboarding model output claim owner settings', async () => {
  const { store, character } = await setup();
  const structuredOutput: LLMProvider['structuredOutput'] = async (_turns, schema) =>
    schema.parse({
      ...character.persona,
      userSteering: { personality: '这是模型填写的' },
    });
  const provider = { structuredOutput } as LLMProvider;
  const service = new CharacterService(store, async () => provider);
  await expect(
    service.personaFor({ ...defaultAnswers, name: '小岚' }, character.id),
  ).rejects.toThrow();
});

it('preserves the owner settings through character export and import', async () => {
  const { store, character, draft } = await setup();
  await store.put('characters', { ...character, avatar: undefined });
  await updatePersonality(store, character.id, { ...draft, speech: '轻松一点' });
  const bundles = new CharacterBundleService(store, {
    readAvatar: vi.fn(),
    writeAvatar: vi.fn(),
    removeAvatar: vi.fn(),
  });
  const imported = await bundles.importCharacter(await bundles.exportCharacter(character.id));
  expect(imported.id).not.toBe(character.id);
  expect(imported.persona.id).toBe(imported.id);
  expect(imported.persona.userSteering).toEqual({ speech: '轻松一点' });
  expect(imported.persona.portrait).toBe(character.persona.portrait);
});
