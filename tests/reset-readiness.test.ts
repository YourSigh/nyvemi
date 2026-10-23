import { it, expect } from 'vitest';
import { TestDatabase } from './database';
import { migrate, SQLiteStore } from '../src/storage/store';
import { CharacterService, defaultAnswers } from '../src/characters/service';
import { resetCharacter, type CharacterCleanup } from '../src/characters/reset';
import { proactiveReadiness } from '../src/proactive/readiness';
import { defaultSettings } from '../src/domain/models';
import { deepSeekPreset } from '../src/providers/provider';
import { UsageLedger } from '../src/usage/ledger';
const cleanup: CharacterCleanup = {
  stop: async () => {},
  cancelNotification: async () => {},
  removeShortcut: async () => {},
  removeAvatar: async () => {},
};
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const service = new CharacterService(store, async () => {
    throw new Error('unused');
  });
  const c = await service.create({ ...defaultAnswers, name: '桶砸' }, true);
  return { db, store, service, c };
}
it('requires the exact current name, clears owned entities and blocks stale resurrection while retaining billing/provider', async () => {
  const { db, store, c } = await setup();
  const ledger = new UsageLedger(db);
  await store.put('provider', deepSeekPreset);
  await ledger.record({
    requestId: 'usage',
    model: 'test',
    endpoint: 'https://example.com',
    purpose: 'test',
    startedAt: 1,
    duration: 1,
    success: true,
  });
  const m = {
    id: 'm',
    characterId: c.id,
    role: 'user' as const,
    content: 'private',
    createdAt: 1,
    origin: 'chat' as const,
    status: 'complete' as const,
  };
  await store.put('messages', m);
  await expect(resetCharacter(store, c.id, ' 桶砸', cleanup)).rejects.toThrow('完整名字');
  expect(await store.get('messages', 'm')).toBeDefined();
  await resetCharacter(store, c.id, '桶砸', cleanup);
  expect(await store.list('characters')).toHaveLength(0);
  expect(await store.list('settings')).toHaveLength(0);
  expect(await store.list('messages')).toHaveLength(0);
  await store.put('characters', c);
  await store.put('messages', m);
  expect(await store.get('characters', c.id)).toBeUndefined();
  expect(await store.get('messages', 'm')).toBeUndefined();
  expect(await store.get('provider', 'provider')).toBeDefined();
  expect((await ledger.summary())[0].requests).toBe(1);
});
it('refuses reset during an active task and releases partial locks without deleting', async () => {
  const { store, c } = await setup();
  await store.lease('heartbeat', Date.now(), 60000);
  await expect(resetCharacter(store, c.id, c.persona.name, cleanup)).rejects.toThrow('稍后');
  expect(await store.get('characters', c.id)).toBeDefined();
  expect(await store.lease('background-cycle', Date.now(), 1000)).toBe(true);
});
it('does not erase data if OS cleanup fails', async () => {
  const { store, c } = await setup();
  await expect(
    resetCharacter(store, c.id, c.persona.name, {
      ...cleanup,
      stop: async () => {
        throw new Error('OS');
      },
    }),
  ).rejects.toThrow('OS');
  expect(await store.get('characters', c.id)).toBeDefined();
});
it('respects an explicit interview opt-out while normal companion setup enables initiative', async () => {
  const { store, service, c } = await setup();
  expect((await store.get('settings', c.id))?.proactiveEnabled).toBe(true);
  const quiet = await service.create(
    { ...defaultAnswers, name: '安静', initiative: '等我开启主动来信后再找我' },
    true,
  );
  expect((await store.get('settings', quiet.id))?.proactiveEnabled).toBe(false);
});
it('explains permissions, disabled initiative, recent activity and no-topic states', () => {
  const now = Date.now(),
    settings = {
      ...defaultSettings('x'),
      proactiveEnabled: true,
      quietStart: 0,
      quietEnd: 0,
      lastActiveAt: now - 4 * 3600000,
    };
  expect(proactiveReadiness(settings, [], [], false, now)).toContain('渠道');
  expect(proactiveReadiness({ ...settings, proactiveEnabled: false }, [], [], true, now)).toContain(
    '尚未开启',
  );
  expect(proactiveReadiness({ ...settings, lastActiveAt: now }, [], [], true, now)).toContain(
    '刚刚',
  );
  expect(proactiveReadiness(settings, [], [], true, now)).toContain('还没有值得');
});
