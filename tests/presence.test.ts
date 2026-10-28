import { it, expect } from 'vitest';
import { idleActivity } from '../src/presence/loop';
import { ActivityMonitor } from '../src/presence/activity';
import { defaultSettings, demoPersona, type Character, type Intention } from '../src/domain/models';
const now = new Date(2026, 9, 22, 20).getTime();
const c: Character = {
  id: 'c',
  persona: demoPersona('c'),
  state: { energy: 0.7, relationshipCloseness: 0.3, recentFocus: [], curiosityTopics: [] },
  interests: [],
  createdAt: 1,
};
const settings = { ...defaultSettings('c'), proactiveEnabled: true, lastActiveAt: now - 3600000 };
it('shows quiet hours, offline status and real pending intentions instead of invented activities', () => {
  expect(idleActivity(c, settings, [], now, false)).toContain('离线');
  expect(idleActivity(c, { ...settings, proactiveEnabled: false }, [], now)).toContain('尚未开启');
  expect(idleActivity(c, { ...settings, quietStart: 19, quietEnd: 22 }, [], now)).toContain(
    '安静时段',
  );
  const intention: Intention = {
    id: 'i',
    characterId: 'c',
    type: 'follow_up',
    topic: '会议',
    reason: '问问结果',
    importance: 0.8,
    earliestAt: now,
    latestAt: now + 3600000,
    status: 'pending',
    createdAt: now,
  };
  expect(idleActivity(c, settings, [intention], now)).toContain('没聊完');
  expect(idleActivity(c, settings, [{ ...intention, latestAt: now - 1 }], now)).not.toContain(
    '没聊完',
  );
});
it('removes status listeners when a session ends', () => {
  const monitor = new ActivityMonitor();
  let called = 0;
  const unsubscribe = monitor.subscribe(() => {
    called++;
  });
  monitor.report('writing', 'c');
  unsubscribe();
  monitor.report('sent', 'c');
  expect(called).toBe(1);
});
