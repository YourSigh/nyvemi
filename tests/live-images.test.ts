import { exportLook } from '../src/appearance/bundle';
import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { SeedreamImageProvider } from '../src/appearance/seedream';
import { defaultImageSettings } from '../src/appearance/model';
import type { ImageAssets } from '../src/appearance/service';
const live =
  process.env.NYVEMI_RUN_LIVE_IMAGES === '1' && process.env.NYVEMI_ARK_ENABLE_LIVE_TESTS === '1';
it.skipIf(!live)(
  'checks paid decomposition with durable cache and bounded requests',
  async () => {
    mkdirSync('artifacts/live-images', { recursive: true });
    const root = resolve('artifacts/live-images');
    const reference = resolve(
      process.env.NYVEMI_ARK_REFERENCE || 'artifacts/character-reference/tongza-original.png',
    );
    if (!existsSync(reference)) throw new Error('缺少本地参考图，请设置 NYVEMI_ARK_REFERENCE');
    const hash = async (v: string) => createHash('sha256').update(v).digest('hex');
    const PNG = createRequire(import.meta.url)('pngjs').PNG;
    const size = (bytes: Uint8Array) => {
      const png = PNG.sync.read(Buffer.from(bytes));
      return { width: png.width as number, height: png.height as number };
    };
    const io: ImageAssets = {
      exists: async (a) => existsSync(a.uri),
      fingerprint: async (a) => hash(readFileSync(a.uri).toString('base64')),
      dataUrl: async (a) => `data:image/png;base64,${readFileSync(a.uri).toString('base64')}`,
      download: async (url, key) => {
        const path = resolve(root, `${key}.png`);
        if (!existsSync(path)) {
          const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
          if (!response.ok) throw new Error(`图片下载失败 ${response.status}`);
          writeFileSync(path, new Uint8Array(await response.arrayBuffer()));
        }
        return { uri: path, ...size(readFileSync(path)) };
      },
    };
    const db = new TestDatabase(resolve(root, 'cache.sqlite'));
    await migrate(db);
    const store = new SQLiteStore(db);
    let budget = Math.min(
      process.env.NYVEMI_ARK_REPAIR_BODY === '1' ? 3 : 2,
      Math.max(0, Number(process.env.NYVEMI_ARK_LIVE_MAX_REQUESTS) || 0) +
        (process.env.NYVEMI_ARK_REPAIR_BODY === '1' ? 1 : 0),
    );
    const budgetPath = resolve(root, 'budget.json');
    const prior = existsSync(budgetPath)
      ? JSON.parse(readFileSync(budgetPath, 'utf8'))
      : existsSync(resolve(root, 'result.json'))
        ? JSON.parse(readFileSync(resolve(root, 'result.json'), 'utf8'))
        : { requests: 0 };
    budget = Math.max(budget, Math.min(3, Number(prior.limit) || 0));
    let requests = Number(prior.requests) || 0;
    const http: typeof fetch = async (url, init) => {
      if (requests >= budget) throw new Error('已达到本次付费请求上限');
      requests++;
      writeFileSync(budgetPath, JSON.stringify({ requests, limit: budget }));
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(180000) });
      // Keep API errors private, report only code/message without the API key.
      if (!response.ok) {
        const error = await response
          .clone()
          .json()
          .catch(() => ({}));
        const text = JSON.stringify({ status: response.status, error }).replaceAll(
          process.env.NYVEMI_ARK_API_KEY!,
          '[REDACTED]',
        );
        writeFileSync(resolve(root, 'last-error.json'), text);
      }
      return response;
    };
    const provider = new SeedreamImageProvider(
      {
        ...defaultImageSettings,
        provider: 'seedream',
        baseUrl: process.env.NYVEMI_ARK_BASE_URL!,
        imageModel: process.env.NYVEMI_ARK_IMAGE_MODEL!,
        layerModel: process.env.NYVEMI_ARK_LAYER_MODEL!,
      },
      async () => process.env.NYVEMI_ARK_API_KEY!,
      store,
      io,
      hash,
      http,
    );
    try {
      let rig = await provider.split({ uri: reference, ...size(readFileSync(reference)) });
      if (process.env.NYVEMI_ARK_REPAIR_BODY === '1')
        rig = await provider.repairBody({ uri: reference, ...size(readFileSync(reference)) }, rig);
      writeFileSync(resolve(root, 'rig.json'), JSON.stringify(rig, null, 2));
      writeFileSync(
        resolve('artifacts', 'reference-character.nyvemi-look'),
        await exportLook(rig, async (uri) => new Uint8Array(readFileSync(uri))),
      );
      expect(rig.layers.some((l) => l.role === 'eyes')).toBe(true);
      await provider.split({ uri: reference, ...size(readFileSync(reference)) });
      expect(requests).toBeLessThanOrEqual(budget);
    } finally {
      const receipts = await store.list('imageRequests');
      writeFileSync(
        resolve(root, 'result.json'),
        JSON.stringify(
          {
            requests,
            receipts: receipts.map((r) => ({ id: r.id, status: r.status })),
            models: {
              generation: process.env.NYVEMI_ARK_IMAGE_MODEL,
              split: process.env.NYVEMI_ARK_LAYER_MODEL,
            },
          },
          null,
          2,
        ),
      );
    }
  },
  360000,
);
