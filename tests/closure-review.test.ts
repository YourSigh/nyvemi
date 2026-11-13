import { expect, it, vi } from 'vitest';
import { needsClosureReview, reviewClosure } from '../src/chat/closure-review';
import type { Message } from '../src/domain/models';
import type { LLMProvider } from '../src/providers/provider';

const message: Message = {
  id: 'latest',
  characterId: 'c',
  role: 'user',
  content: '简短话语',
  createdAt: 1_000_000_000,
  origin: 'chat',
  status: 'pending',
};
const assistant: Message = { ...message, id: 'prior', role: 'assistant', status: 'complete' };

it('limits the independent review to brief ongoing exchanges or a marked long close', () => {
  const long = { ...message, content: '长'.repeat(100) };
  expect(needsClosureReview(message, [], false)).toBe(false);
  expect(needsClosureReview(message, [assistant], false)).toBe(true);
  expect(needsClosureReview(long, [assistant], false)).toBe(false);
  expect(needsClosureReview(long, [assistant], true)).toBe(true);
  expect(needsClosureReview({ ...message, attachments: ['a'] }, [assistant], true)).toBe(false);
  const old = { ...assistant, createdAt: message.createdAt - 3_600_000 };
  expect(needsClosureReview(message, [old], false)).toBe(false);
});

it('keeps delivery bounded even if a provider ignores the abort signal', async () => {
  vi.useFakeTimers();
  try {
    const structuredOutput = vi.fn(() => new Promise<never>(() => {}));
    const provider = { structuredOutput } as unknown as LLMProvider;
    const signal = new AbortController().signal;
    const review = reviewClosure(provider, [assistant], message, ['再说一句'], signal);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(review).resolves.toBe('unavailable');
    expect(structuredOutput).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
