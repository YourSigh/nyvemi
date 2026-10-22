import { it, expect } from 'vitest';
import { idleActivity, runPresenceLoop, type PresenceState } from '../src/presence/loop';
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
it('checks every minute but runs no more than one local cycle each ten minutes', async () => {
  let tick = 0;
  let cycles = 0;
  let idle = 0;
  await runPresenceLoop({
    state: () => ({ enabled: tick < 25, running: true, characterId: 'c' }),
    online: () => true,
    cycle: async () => {
      cycles++;
    },
    idle: async () => {
      idle++;
    },
    error: async () => {},
    sleep: async (ms) => {
      expect(ms).toBe(60000);
      tick++;
    },
    now: () => tick * 60000,
  });
  expect(cycles).toBe(3);
  expect(idle).toBe(25);
});
it('does no model cycle offline and recovers when connectivity returns', async () => {
  let tick = 0;
  let cycles = 0;
  await runPresenceLoop({
    state: () => ({ enabled: tick < 5, running: true, characterId: 'c' }),
    online: () => tick >= 3,
    cycle: async () => {
      cycles++;
    },
    idle: async () => {},
    error: async () => {},
    sleep: async () => {
      tick++;
    },
    now: () => tick * 60000,
  });
  expect(cycles).toBe(1);
});
it('stops promptly without a new sleep after native stop during a cycle and survives cycle errors', async () => {
  const state: PresenceState = { enabled: true, running: true, characterId: 'c' };
  let errors = 0;
  let sleeps = 0;
  await runPresenceLoop({
    state: () => state,
    online: () => true,
    cycle: async () => {
      state.running = false;
      throw new Error('fixture');
    },
    idle: async () => {},
    error: async () => {
      errors++;
    },
    sleep: async () => {
      sleeps++;
    },
    now: () => 0,
  });
  expect(errors).toBe(1);
  expect(sleeps).toBe(0);
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
