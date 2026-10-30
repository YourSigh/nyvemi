import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { MediaService } from '../src/media/service';
import { defaultMediaSettings } from '../src/media/model';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona } from '../src/domain/models';
it.skipIf(process.env.NYVEMI_RUN_LIVE_VISION !== '1')(
  'runs at most one explicitly enabled real vision request and verifies cached reuse',
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
    const deepseek = process.env.NYVEMI_LIVE_VISION_SOURCE === 'chat';
    let bytes = readFileSync('assets/nyvemi-icon.png');
    if (deepseek) {
      const { PNG } = createRequire(import.meta.url)('pngjs');
      const png = new PNG({ width: 320, height: 200 });
      for (let y = 0; y < png.height; y++)
        for (let x = 0; x < png.width; x++) {
          const p = (y * png.width + x) * 4;
          png.data[p] = x < 160 ? 255 : 0;
          png.data[p + 1] = 0;
          png.data[p + 2] = x < 160 ? 0 : 255;
          png.data[p + 3] = 255;
        }
      bytes = PNG.sync.write(png);
    }
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
      visionSource: deepseek ? 'chat' : 'custom',
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
      chatVision: async () => ({
        baseUrl: process.env.NYVEMI_VISION_BASE_URL!,
        model: process.env.NYVEMI_VISION_MODEL!,
        key: process.env.NYVEMI_VISION_API_KEY!,
      }),
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
    const question = deepseek
      ? '请分别描述图片左半边和右半边的颜色，简短回答。'
      : '请描述图中的颜色和图形，简短回答。';
    const result = await service.inspect(cid, 'test-image', question);
    expect(result.trim()).not.toBe('');
    if (deepseek) {
      expect(result).toMatch(/左[^。\n]*红/);
      expect(result).toMatch(/右[^。\n]*蓝/);
    }
    expect(await service.inspect(cid, 'test-image', question)).toBe(result);
    expect(requests).toBe(1);
    writeFileSync(
      'artifacts/live-vision.json',
      JSON.stringify(
        { requests, provider: deepseek ? 'DeepSeek' : 'Ark', result, cachedReuse: true },
        null,
        2,
      ),
    );
  },
  100000,
);
