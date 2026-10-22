import { it, expect } from 'vitest';
import { defaultSettings } from '../src/domain/models';
import { markAppActive, updateSettings } from '../src/application/settings';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
it('preserves background timestamps while saving editable settings and validates RSS', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('settings', { ...defaultSettings('c'), lastRssAt: 123 });
  await markAppActive(store, 456);
  await updateSettings(store, 'c', { dailyLimit: 1, rssUrls: ['https://example.org/rss'] });
  const settings = await store.get('settings', 'c');
  expect(settings?.lastActiveAt).toBe(456);
  expect(settings?.lastRssAt).toBe(123);
  await expect(
    updateSettings(store, 'c', { rssUrls: ['https://user:secret@example.org'] }),
  ).rejects.toThrow();
  await expect(updateSettings(store, 'c', { quietStart: 24 })).rejects.toThrow();
});
