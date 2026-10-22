import { it, expect } from 'vitest';
import { saveProviderSettings } from '../src/application/provider-settings';
import { deepSeekPreset } from '../src/providers/provider';
import { TestDatabase } from './database';
import { migrate, SQLiteStore } from '../src/storage/store';
it('never transfers a saved key silently to another provider or puts it in SQLite', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  let key: string | null = null;
  const secrets = {
    get: async () => key,
    set: async (v: string) => {
      key = v;
    },
    remove: async () => {
      key = null;
    },
  };
  await saveProviderSettings(store, secrets, deepSeekPreset, 'test-device-secret');
  await expect(
    saveProviderSettings(
      store,
      secrets,
      { ...deepSeekPreset, baseUrl: 'https://other.example/v1' },
      '',
    ),
  ).rejects.toThrow('重新输入');
  expect(key).toBe('test-device-secret');
  expect(JSON.stringify(await store.list('provider'))).not.toContain('test-device-secret');
  await saveProviderSettings(store, secrets, { ...deepSeekPreset, model: 'custom' }, '');
  expect((await store.get('provider', 'provider'))?.model).toBe('custom');
});

it('trims pasted provider addresses and returns a readable validation error', async () => {
  const { validateProviderConfig } = await import('../src/providers/provider');
  expect(
    validateProviderConfig({ ...deepSeekPreset, baseUrl: '  http://10.0.2.2:18978/v1 \n' }).baseUrl,
  ).toBe('http://10.0.2.2:18978/v1');
  expect(() => validateProviderConfig({ ...deepSeekPreset, baseUrl: 'wrong' })).toThrow(
    '请检查 Base URL',
  );
});
