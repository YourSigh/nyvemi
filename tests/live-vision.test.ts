import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MediaService } from '../src/media/service';
import { defaultMediaSettings } from '../src/media/model';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona } from '../src/domain/models';
it.skipIf(process.env.NYVEMI_RUN_LIVE_VISION !== '1')(
  'runs at most one explicitly enabled real Ark vision request',
  async () => {
    const db = new TestDatabase();
    await migrate(db);
    const store = new SQLiteStore(db),
      cid = 'vision-test';
    await store.put('characters', {
      id: cid,
      persona: demoPersona(cid),
      state: { energy: 0.7, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
      interests: [],
      createdAt: 1,
    });
    const bytes = readFileSync('assets/nyvemi-icon.png');
    await store.put('mediaAssets', {
      id: 'test-image',
      characterId: cid,
      createdAt: Date.now(),
      uri: 'local-fixture',
      fingerprint: createHash('sha256').update(bytes).digest('hex'),
      mime: 'image/png',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      origin: 'upload',
    });
    await store.put('mediaSettings', {
      ...defaultMediaSettings,
      visionBaseUrl: process.env.NYVEMI_VISION_BASE_URL!,
      visionModel: process.env.NYVEMI_VISION_MODEL!,
    });
    let requests = 0;
    const service = new MediaService(store, {
      files: {
        dataUrl: async () => `data:image/png;base64,${bytes.toString('base64')}`,
        remove: async () => {},
      },
      hash: async (text) => createHash('sha256').update(text).digest('hex'),
      secret: async () => process.env.NYVEMI_VISION_API_KEY!,
      metric: async (metric) => {
        writeFileSync('artifacts/live-vision-usage.json', JSON.stringify(metric, null, 2));
      },
      generate: async () => {
        throw Error('not a drawing test');
      },
      request: async (...args) => {
        if (++requests > 1) throw Error('vision request budget');
        return fetch(...args);
      },
    });
    const result = await service.inspect(cid, 'test-image', '请描述图中的颜色和图形，简短回答。');
    expect(result.trim()).not.toBe('');
    writeFileSync('artifacts/live-vision.json', JSON.stringify({ requests, result }, null, 2));
  },
  100000,
);
