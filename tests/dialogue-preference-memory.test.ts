import { expect, it } from 'vitest';
import type { Message } from '../src/domain/models';
import {
  dialoguePreferences,
  recordedDialoguePreference,
  saveDialoguePreference,
} from '../src/memory/dialogue-preference';
import { MemoryRepository } from '../src/memory/repository';
import { migrate, SQLiteStore } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona } from './test-fixtures';

async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  for (const id of ['c', 'other']) {
    await store.put('characters', {
      id,
      persona: demoPersona(id),
      state: { energy: 0.7, relationshipCloseness: 0.1, recentFocus: [], curiosityTopics: [] },
      interests: [],
      createdAt: 1,
    });
  }
  const repo = new MemoryRepository(store);
  return { store, repo };
}

async function preference(
  store: SQLiteStore,
  id: string,
  createdAt: number,
  key: string,
  action: 'set' | 'forget',
  text: string,
  characterId = 'c',
) {
  const message: Message = {
    id,
    characterId,
    role: 'user',
    content: text,
    createdAt,
    origin: 'chat',
    status: 'complete',
  };
  await store.put('messages', message);
  const change =
    action === 'set'
      ? { action, key, quote: text, preference: text }
      : { action, key, quote: text };
  await saveDialoguePreference(store, message, change, async (value) => value);
  return { message, change, id: `dialogue-preference:${id}:${key}` };
}

it('projects each active preference once in the memory page and hides retracted history', async () => {
  const { store, repo } = await setup();
  const old = await preference(store, 'u1', 20, 'message-length', 'set', '尽量一句说完');
  const latest = await preference(store, 'u2', 30, 'message-length', 'set', '长话可以分开聊');
  await preference(store, 'u3', 40, 'emoji', 'set', '聊天少用表情');
  const retracted = await preference(store, 'u4', 50, 'emoji', 'forget', '表情的习惯不用记了');
  const regular = await repo.upsert('c', 'semantic', '周末爬山', 0.8, 10);

  expect((await repo.listVisible('c')).map((memory) => memory.id)).toEqual([latest.id, regular.id]);
  expect((await repo.get(old.id))?.content).toBe('尽量一句说完');
  expect((await repo.get(retracted.id))?.metadata?.action).toBe('forget');
  expect(await dialoguePreferences(store, 'c')).toEqual([
    { key: 'message-length', preference: '长话可以分开聊' },
  ]);
});

it('forgetting a preference on the memory page clears all versions and cannot reactivate old ones', async () => {
  const { store, repo } = await setup();
  const old = await preference(store, 'u1', 20, 'message-length', 'set', '尽量一句说完');
  const latest = await preference(store, 'u2', 30, 'message-length', 'set', '长话可以分开聊');
  const distinct = await preference(store, 'u3', 40, 'emoji', 'set', '聊天少用表情');
  const anotherCharacter = await preference(
    store,
    'u4',
    50,
    'message-length',
    'set',
    '别省略细节',
    'other',
  );

  await repo.remove(latest.id);
  expect(await dialoguePreferences(store, 'c')).toEqual([
    { key: 'emoji', preference: '聊天少用表情' },
  ]);
  expect((await repo.listVisible('c')).map((memory) => memory.id)).toEqual([distinct.id]);
  expect((await repo.listVisible('other')).map((memory) => memory.id)).toEqual([
    anotherCharacter.id,
  ]);

  for (const event of [old, latest]) {
    const record = await repo.get(event.id);
    expect(record?.metadata?.action).toBe('forget');
    expect(record?.content).not.toContain(event.message.content);
    expect(await recordedDialoguePreference(store, 'c', event.message.id)).toBe(true);
    await expect(
      saveDialoguePreference(store, event.message, event.change, async (value) => value),
    ).resolves.toEqual({ action: 'forget', key: 'message-length' });
  }

  await preference(store, 'u5', 60, 'message-length', 'set', '需要解释时可以多聊几句');
  expect(await dialoguePreferences(store, 'c')).toContainEqual({
    key: 'message-length',
    preference: '需要解释时可以多聊几句',
  });
});
