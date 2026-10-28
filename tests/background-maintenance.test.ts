import { it, expect, vi } from 'vitest';
import { runMaintenance, type MaintenancePorts } from '../src/proactive/heartbeat/maintenance';
import { trackVisibleActivity } from '../src/application/activity';
import { policyBlock } from '../src/proactive/policies';
import { SQLiteStore, migrate } from '../src/storage/store';
import { defaultSettings } from '../src/domain/models';
import { TestDatabase } from './database';

const now = new Date(2026, 9, 28, 15).getTime();
it('background ticks cannot renew user activity and indefinitely suppress autonomous delivery', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('settings', {
    ...defaultSettings('c'),
    proactiveEnabled: true,
    lastActiveAt: now,
  });
  await trackVisibleActivity(store, () => true, now + 60000);
  for (let minute = 2; minute <= 40; minute++)
    await trackVisibleActivity(store, () => false, now + minute * 60000);
  const settings = (await store.get('settings', 'c'))!;
  expect(settings.lastActiveAt).toBe(now + 60000);
  expect(policyBlock(settings, [], now + 40 * 60000)).toBeUndefined();
  await trackVisibleActivity(store, () => true, now + 41 * 60000);
  expect(policyBlock((await store.get('settings', 'c'))!, [], now + 41 * 60000)).toBe(
    'recent_active_chat',
  );
});
it('does not write an activity timestamp if app backgrounds while waiting for SQLite', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('settings', { ...defaultSettings('c'), lastActiveAt: 1 });
  let foreground = true;
  const atomic = store.atomic.bind(store);
  vi.spyOn(store, 'atomic').mockImplementation(async (work) => {
    foreground = false;
    return atomic(work);
  });
  await trackVisibleActivity(store, () => foreground, now);
  expect((await store.get('settings', 'c'))!.lastActiveAt).toBe(1);
});
function ports(log: string[]): MaintenancePorts {
  return Object.fromEntries(
    ['requested', 'continuations', 'reconnects', 'cycle', 'sync', 'idle', 'error'].map((name) => [
      name,
      async () => {
        log.push(name);
      },
    ]),
  ) as unknown as MaintenancePorts;
}
it('delivers due conversation intentions before slow experience/extraction, without a foreground dependency', async () => {
  const log: string[] = [];
  expect(await runMaintenance(ports(log), true)).toBe(true);
  expect(log).toEqual(['requested', 'continuations', 'reconnects', 'cycle', 'sync', 'idle']);
});
it('runs a finite fast tick without RSS or extraction and can run repeatedly', async () => {
  const log: string[] = [];
  for (let n = 0; n < 3; n++) expect(await runMaintenance(ports(log), false)).toBe(true);
  expect(log).not.toContain('cycle');
  expect(log.filter((n) => n === 'requested')).toHaveLength(3);
});
it('a failed delivery lane does not starve other lanes; failed ticks request a retry', async () => {
  const log: string[] = [];
  const deps = ports(log);
  deps.requested = async () => {
    throw new Error('fixture only');
  };
  deps.error = async () => {
    throw new Error('diagnostic storage unavailable');
  };
  expect(await runMaintenance(deps, true)).toBe(false);
  expect(log).toEqual(['continuations', 'reconnects', 'cycle', 'sync', 'idle']);
});
it('acknowledges maintenance failure if scheduling or status update fails', async () => {
  for (const lane of ['sync', 'idle'] as const) {
    const deps = ports([]);
    deps[lane] = async () => {
      throw new Error('fixture');
    };
    expect(await runMaintenance(deps, false)).toBe(false);
  }
});
