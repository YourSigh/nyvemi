import { expect, it } from 'vitest';
import { timeMarkers, appendDictation } from '../src/chat/presentation';
import type { Message } from '../src/domain/models';
it('groups nearby bubble times while preserving a marker after a long gap', () => {
  const base: Message = {
    id: '1',
    characterId: 'c',
    role: 'assistant',
    content: '诶',
    createdAt: 1000000,
    origin: 'chat',
    status: 'complete',
  };
  expect([
    ...timeMarkers([
      base,
      { ...base, id: '2', createdAt: base.createdAt + 1 },
      { ...base, id: '3', createdAt: base.createdAt + 600001 },
    ]),
  ]).toEqual(['1', '3']);
});
it('puts system dictation into the composer for review without sending or replacing a draft', () => {
  expect(appendDictation('刚才 ', ' 想到一点 ')).toBe('刚才 想到一点');
  expect(appendDictation('原来的话', null)).toBe('原来的话');
  expect(appendDictation('a'.repeat(6000), '后续')).toHaveLength(6000);
});
