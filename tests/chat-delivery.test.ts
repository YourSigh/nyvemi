import { demoPersona } from './persona-fixture';
import { it, expect, vi } from 'vitest';
import { messageChunks, typingDelay, waitForBubble } from '../src/chat/delivery';
import { ChatService } from '../src/chat/service';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';

import { Diagnostics } from '../src/storage/diagnostics';
import type { LLMProvider } from '../src/providers/provider';
it('splits prose paragraphs and preserves code/list formatting', () => {
  expect(messageChunks(['诶\n\n我突然想到一个事', '等我说完'])).toEqual([
    '诶',
    '我突然想到一个事',
    '等我说完',
  ]);
  expect(messageChunks(['```ts\nconst x = 1\n```'])).toHaveLength(1);
  expect(messageChunks(['步骤\n- 第一项\n- 第二项'])).toHaveLength(1);
});
it('length controls each delay, first message credits model latency, and long messages are bounded', () => {
  expect(typingDelay('好', true)).toBeLessThan(typingDelay('这件事我想了想还是觉得有点好笑', true));
  expect(typingDelay('好', true, 9000)).toBe(350);
  expect(typingDelay('后来我又想到了另一件事', false, 9000)).toBeGreaterThan(1500);
  expect(typingDelay('字'.repeat(6000), false)).toBe(12000);
});
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 0.7, relationshipCloseness: 0.5, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  });
  return store;
}
it('contextual listen decisions stay silent without response generation or erroneous retry state', async () => {
  const store = await setup();
  const provider = vi
    .fn()
    .mockResolvedValue({ chat: async () => ({ content: '{\"action\":\"listen\"}' }) });
  const afterRound = vi.fn();
  const pause = vi.fn();
  const chat = new ChatService(
    store,
    provider,
    new Diagnostics(store),
    { retrieve: async () => [], afterRound },
    pause,
  );
  for (let n = 0; n < 5; n++) await chat.send('c', '。', () => {});
  await chat.recoverInterrupted('c');
  expect(provider).toHaveBeenCalledTimes(5);
  expect(afterRound).toHaveBeenCalled();
  expect(pause).not.toHaveBeenCalled();
  expect(
    (await chat.history('c')).every(
      (m) => m.role === 'user' && m.status === 'complete' && m.replyDisposition === 'silence',
    ),
  ).toBe(true);
});
it('waits for full output and per-message typing time before revealing separate paragraphs', async () => {
  const store = await setup();
  const visible: string[][] = [];
  const pause = vi.fn(async () => {
    visible.push(
      (await chat.history('c')).filter((m) => m.role === 'assistant').map((m) => m.content),
    );
  });
  const provider = {
    chat: async () => ({ content: JSON.stringify({ action: 'reply' }), usage: {} }),
    streamChat: async (_: unknown, delta: (s: string) => void) => {
      delta('{"messages":["诶');
      expect((await chat.history('c')).filter((m) => m.role === 'assistant')).toHaveLength(0);
      return { content: '{"messages":["诶\\n\\n我想了想，还是想把这件事告诉你"]}', usage: {} };
    },
  } as unknown as LLMProvider;
  const chat = new ChatService(
    store,
    async () => provider,
    new Diagnostics(store),
    undefined,
    pause,
  );
  await chat.send('c', '今天发现个有意思的事情', () => {});
  expect(visible).toEqual([[], ['诶']]);
  expect(pause.mock.calls).toHaveLength(2);
  expect(
    (await chat.history('c')).filter((m) => m.role === 'assistant').map((m) => m.content),
  ).toEqual(['诶', '我想了想，还是想把这件事告诉你']);
});

it('overlaps speech preparation with typing and bounds its effect on text delivery', async () => {
  vi.useFakeTimers();
  try {
    let shown = false;
    const wait = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 350)));
    const prepare = vi.fn(() => new Promise<boolean>(() => {}));
    const delivery = waitForBubble('bubble', '我在', wait, prepare).then(() => {
      shown = true;
    });
    expect(prepare).toHaveBeenCalledWith('bubble', '我在');
    expect(wait).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(shown).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await delivery;
    expect(shown).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it('delivers at the original typing pace when speech is ready or fails early', async () => {
  vi.useFakeTimers();
  try {
    for (const ready of [true, false]) {
      const start = Date.now();
      const pending = waitForBubble(
        'bubble',
        '我在',
        () => new Promise<void>((resolve) => setTimeout(resolve, 350)),
        () => (ready ? Promise.resolve(true) : Promise.reject(Error('voice unavailable'))),
      ).then(() => Date.now() - start);
      await vi.advanceTimersByTimeAsync(350);
      expect(await pending).toBe(350);
    }
  } finally {
    vi.useRealTimers();
  }
});
