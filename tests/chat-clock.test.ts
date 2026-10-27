import { expect, it } from 'vitest';
import { localTimeContext, buildChatPrompt } from '../src/chat/prompt';
import { demoPersona, type Character } from '../src/domain/models';
it('uses an unambiguous fresh local date, 24-hour clock and time-of-day instead of mixing UTC timestamps', () => {
  const morning = new Date(2026, 9, 27, 11, 40, 5).getTime(),
    evening = new Date(2026, 9, 27, 20, 7, 2).getTime();
  expect(localTimeContext(morning)).toContain('2026-10-27 星期二 11:40:05');
  expect(localTimeContext(morning)).toContain('上午');
  expect(localTimeContext(evening)).toContain('20:07:02');
  expect(localTimeContext(evening)).toContain('晚上');
  expect(localTimeContext(morning)).not.toContain('T03:40');
});
it('places the native per-turn clock after past-message metadata and character examples', () => {
  const c: Character = {
    id: 'c',
    persona: demoPersona('c'),
    createdAt: 1,
    interests: [],
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  };
  const prompt = buildChatPrompt(c, [], [], Date.now(), '本轮设备权威时间 23:58');
  expect(prompt[0].content.endsWith('本轮设备权威时间 23:58')).toBe(true);
});
