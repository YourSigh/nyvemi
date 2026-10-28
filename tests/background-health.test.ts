import { expect, it } from 'vitest';
import {
  backgroundSnapshot,
  backgroundSummary,
  type BackgroundHealth,
} from '../src/proactive/background-health';
import { deliveryReport } from '../src/proactive/delivery-report';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
const now = 10000000;
function health(): BackgroundHealth {
  return {
    fast: {
      stage: 'finished',
      source: 'presence_service',
      startedAt: now - 1000,
      finishedAt: now,
      updatedAt: now,
    },
    full: { stage: 'never', source: 'unknown', startedAt: 0, finishedAt: 0, updatedAt: 0 },
    workStates: ['ENQUEUED'],
    batteryUnrestricted: false,
    deviceIdle: false,
  };
}
it('distinguishes missing work, native startup failure and a stale visible service', () => {
  const state = health();
  expect(backgroundSummary({ ...state, workStates: [] }, true, now)).toContain('未登记');
  expect(
    backgroundSummary({ ...state, fast: { ...state.fast, stage: 'runtime_timeout' } }, true, now),
  ).toContain('执行失败');
  expect(backgroundSummary(state, true, now + 5 * 60000)).toContain('近期未完成检查');
});
it('explains Doze and distinguishes completed checks from a promise of a proactive message', () => {
  const state = health();
  expect(backgroundSummary({ ...state, deviceIdle: true }, true, now)).toContain('省电休眠');
  expect(
    backgroundSummary({ ...state, deviceIdle: true, batteryUnrestricted: true }, true, now),
  ).toContain('已执行');
  expect(backgroundSummary(state, false, now)).toContain('常驻陪伴未开启');
  expect(
    backgroundSummary({ ...state, fast: { ...state.fast, stage: 'running_js' } }, true, now),
  ).toContain('正在检查');
});
it('excludes extra native fields from shared diagnostics including nested snapshots', async () => {
  const state = {
    ...health(),
    apiKey: 'fixture-credential',
    fast: { ...health().fast, prompt: '私人聊天内容' },
  };
  expect(JSON.stringify(backgroundSnapshot(state))).not.toContain('fixture-credential');
  const db = new TestDatabase();
  await migrate(db);
  const report = await deliveryReport(
    new SQLiteStore(db),
    'c',
    async () => {
      throw new Error();
    },
    {
      notifications: true,
      online: true,
      presenceRunning: true,
      background: state,
    },
    now,
  );
  const shared = JSON.stringify(report);
  expect(shared).not.toContain('fixture-credential');
  expect(shared).not.toContain('私人');
  expect(report.environment.background?.fast.stage).toBe('finished');
});
