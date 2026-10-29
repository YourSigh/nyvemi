import { expect, it } from 'vitest';
import {
  CharacterStateMapper,
  ChatActivityBus,
  type ChatActivity,
} from '../src/character/interaction';
import { ChatService } from '../src/chat/service';
import { parseChatOutcome } from '../src/chat/outcome';
import { demoPersona, defaultSettings } from '../src/domain/models';
import type { LLMProvider } from '../src/providers/provider';
import { Diagnostics } from '../src/storage/diagnostics';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
it('maps typing, streamed speech, completion emotions and a silent reply without exposing animation details', () => {
  expect(CharacterStateMapper.state(undefined, true)).toBe('listening');
  expect(CharacterStateMapper.state({ phase: 'thinking' }, true)).toBe('thinking');
  expect(CharacterStateMapper.state({ phase: 'talking' }, false)).toBe('talking');
  expect(
    CharacterStateMapper.state(
      { phase: 'complete', hasMessages: true, emotion: 'amused', intensity: 0.62 },
      false,
    ),
  ).toBe('happy');
  expect(CharacterStateMapper.emotion({ emotion: 'annoyed' })).toBe('angry');
  expect(CharacterStateMapper.emotion({ emotion: 'embarrassed' })).toBe('shy');
  expect(CharacterStateMapper.emotion({ emotion: 'tired' })).toBe('sleepy');
  expect(
    CharacterStateMapper.state({ phase: 'complete', hasMessages: false, emotion: 'sad' }, false),
  ).toBe('idle');
  expect(CharacterStateMapper.state({ phase: 'error' }, false)).toBe('idle');
});
it('keeps old responses valid and discards invalid optional metadata rather than losing the reply', () => {
  expect(parseChatOutcome('{"messages":["好呀"]}').messages).toEqual(['好呀']);
  expect(parseChatOutcome('{"messages":["好呀"],"emotion":"unknown","intensity":999}')).toEqual({
    messages: ['好呀'],
    emotion: undefined,
    intensity: undefined,
  });
});
it('isolates observers by character and makes subscriptions disposable and non-blocking', () => {
  const bus = new ChatActivityBus();
  const events: ChatActivity[] = [];
  const unsub = bus.subscribe('a', (e) => events.push(e));
  bus.subscribe('a', () => {
    throw new Error('view gone');
  });
  bus.publish('b', { phase: 'thinking' });
  expect(events).toHaveLength(0);
  bus.publish('a', { phase: 'thinking' });
  unsub();
  bus.publish('a', { phase: 'talking' });
  expect(events).toEqual([{ phase: 'thinking' }]);
});
it('keeps thinking during streaming and talks only when a complete bubble is delivered', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 0.7, relationshipCloseness: 0.2, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  });
  await store.put('settings', defaultSettings('c'));
  const events: ChatActivity[] = [];
  let calls = 0;
  const provider: LLMProvider = {
    chat: async () => ({ content: JSON.stringify({ action: 'reply' }), usage: {} }),
    structuredOutput: async () => {
      throw new Error('no extra emotion request');
    },
    streamChat: async (_, delta) => {
      calls++;
      delta('{');
      expect(events.map((e) => e.phase)).toEqual(['thinking']);
      expect(
        (await store.list('messages', 'c')).filter((m) => m.role === 'assistant'),
      ).toHaveLength(0);
      delta('"messages":');
      return {
        content: '{"messages":["草","这还真挺离谱的"],"emotion":"amused","intensity":0.62}',
        usage: {},
      };
    },
  };
  const chat = new ChatService(
    store,
    async () => provider,
    new Diagnostics(store),
    undefined,
    async () => {},
  );
  chat.subscribe('c', (e) => events.push(e));
  await chat.send('c', '今天又碰到一件离谱的事', () => {});
  expect(calls).toBe(1);
  expect(events.map((e) => e.phase)).toEqual(['thinking', 'talking', 'complete']);
  const replies = (await chat.history('c')).filter((m) => m.role === 'assistant');
  expect(replies).toHaveLength(2);
  expect(replies.every((m) => m.emotion === 'amused' && m.intensity === 0.62)).toBe(true);
});
