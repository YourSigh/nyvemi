import { expect, it } from 'vitest';
import { agentSystem } from '../src/agent/prompt';
import { historyClock } from '../src/agent/prompt-clock';
import type { Character, Message } from '../src/domain/models';
import { demoPersona } from './persona-fixture';

const character: Character = {
  id: 'c',
  persona: demoPersona('c'),
  createdAt: 1,
  interests: [],
  state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
};

function message(id: string, utc: string): Message {
  return {
    id,
    characterId: character.id,
    role: 'user',
    content: '测试历史',
    createdAt: Date.parse(utc),
    status: 'complete',
    origin: 'chat',
  };
}

it('preserves the local day across midnight in the prompt even when both UTC timestamps are yesterday', () => {
  const prompt = agentSystem(
    character,
    [],
    [message('previous', '2026-11-12T15:58:00Z'), message('current', '2026-11-12T16:09:00Z')],
    '【本轮设备时钟】现在是 2026-11-13 星期五 00:20:00（24小时制，凌晨，时区 Asia/Shanghai，UTC偏移 480 分钟）。',
    '',
  );
  expect(prompt).toContain('"localTime":"2026-11-12 23:58:00","localDay":"昨天"');
  expect(prompt).toContain('"localTime":"2026-11-13 00:09:00","localDay":"今天"');
  expect(prompt).not.toContain('2026-11-12T16:09');
  expect(prompt).toContain('task.type 为 share');
  expect(prompt).toContain('只发一到两条短消息');
});

it('uses the historical offset in a device time zone with daylight saving', () => {
  const time = historyClock(
    '【本轮设备时钟】现在是 2026-11-13 星期五 10:00:00（24小时制，上午，时区 America/New_York，UTC偏移 -300 分钟）。',
  );
  expect(time(Date.parse('2026-08-02T04:45:00Z'))).toEqual({
    localTime: '2026-08-02 00:45:00',
    localDay: '2026-08-02',
  });
});

it('uses the explicit device offset if the device time-zone name is unavailable in Intl', () => {
  const time = historyClock(
    '【本轮设备时钟】现在是 2027-01-01 星期五 00:05:00（24小时制，凌晨，时区 Android/Unknown，UTC偏移 345 分钟）。',
  );
  expect(time(Date.parse('2026-12-31T18:16:00Z'))).toEqual({
    localTime: '2027-01-01 00:01:00',
    localDay: '今天',
  });
  expect(time(Date.parse('2026-12-31T18:14:00Z'))).toEqual({
    localTime: '2026-12-31 23:59:00',
    localDay: '昨天',
  });
});
