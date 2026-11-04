import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { SeedreamImageProvider } from '../src/appearance/seedream';
import { defaultImageSettings, SEEDREAM_FLASH, type CharacterRig } from '../src/appearance/model';
import { ImageProviderError } from '../src/appearance/errors';
import type { ImageAssets } from '../src/appearance/service';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
import { SQLiteStore, migrate } from '../src/storage/store';
import { publicUrl } from '../src/agent/web';
import { TestDatabase } from './database';
type Preview = {
  composite: string;
  layers: { role: string; transparent: number; visible: number; preview: string }[];
};
it.skipIf(process.env.NYVEMI_RUN_LIVE_FLASH_SPLIT !== '1')(
  'validates a real Flash decomposition using an existing portrait, bounded billing and actual alpha/composite inspection',
  async () => {
    const arms = process.env.NYVEMI_ARM_SPLIT === '1';
    const refined = process.env.NYVEMI_FLASH_REFINED === '1';
    const root = resolve(
      arms
        ? 'artifacts/live-arm-split'
        : refined
          ? 'artifacts/live-flash-split-refined'
          : 'artifacts/live-flash-split',
    );
    mkdirSync(root, { recursive: true });
    const source = resolve('artifacts/avatar-v2-source/portrait.png');
    if (!existsSync(source)) throw Error('缺少已有简化立绘，停止测试，不自动重新生图');
    const dimensions = (file: string) => {
      const text = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
        encoding: 'utf8',
      });
      return {
        width: Number(/pixelWidth:\s*(\d+)/.exec(text)?.[1]),
        height: Number(/pixelHeight:\s*(\d+)/.exec(text)?.[1]),
      };
    };
    const disk = (uri: string) => (uri.startsWith('file:') ? fileURLToPath(uri) : uri);
    const hash = async (text: string) => createHash('sha256').update(text).digest('hex');
    const assets: ImageAssets = {
      ...(arms && process.env.NYVEMI_ARM_NORMALIZED === '1'
        ? {
            prepareDecomposition: async (a: { uri: string }) => {
              const { PNG } = createRequire(import.meta.url)('pngjs');
              const { decode } = createRequire(import.meta.url)('../scripts/vtuber/psd.cjs');
              const png = decode(disk(a.uri));
              return {
                dataUrl: `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,
                width: png.width,
                height: png.height,
              };
            },
          }
        : {}),
      exists: async (a) => existsSync(disk(a.uri)),
      fingerprint: async (a) => hash(readFileSync(disk(a.uri)).toString('base64')),
      dataUrl: async (a) => {
        const bytes = readFileSync(disk(a.uri));
        return `data:image/${bytes[0] === 137 ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}`;
      },
      download: async (input, key) => {
        const file = resolve(root, `${key}.png`);
        if (!existsSync(file)) {
          let url = publicUrl(input),
            response: Response | undefined;
          for (let n = 0; n < 4; n++) {
            response = await fetch(url.href, {
              redirect: 'manual',
              credentials: 'omit',
              signal: AbortSignal.timeout(60000),
            });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
              const location = response.headers.get('location');
              if (!location) throw Error('图片跳转无地址');
              url = publicUrl(new URL(location, url).href);
              response = undefined;
              continue;
            }
            break;
          }
          if (
            !response?.ok ||
            response.redirected ||
            Number(response.headers.get('content-length')) > 12 * 1024 * 1024
          )
            throw Error('下载失败，已收到的付费响应会保留');
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length > 12 * 1024 * 1024) throw Error('图层过大');
          writeFileSync(file, bytes);
        }
        return { uri: pathToFileURL(file).href, ...dimensions(file) };
      },
    };
    const db = new TestDatabase(resolve(root, 'cache.sqlite'));
    await migrate(db);
    const store = new SQLiteStore(db);
    const budgetFile = resolve(
      arms ? 'artifacts/live-arm-split/budget.json' : 'artifacts/live-flash-split/budget.json',
    );
    const budget: { requests: number; limit: number } = existsSync(budgetFile)
      ? JSON.parse(readFileSync(budgetFile, 'utf8'))
      : { requests: 0, limit: 2 };
    let outputCount = 0,
      usage: unknown,
      rig: CharacterRig | undefined,
      preview: Preview | undefined,
      review: unknown,
      failure: unknown,
      error: string | undefined,
      dsCalls = 0,
      paidPostsThisRun = 0;
    const metrics: ApiMetric[] = [];
    const model = new SeedreamImageProvider(
      defaultImageSettings,
      async () => process.env.NYVEMI_ARK_API_KEY!,
      store,
      assets,
      hash,
      (async (url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (
          String(url) !== `${defaultImageSettings.baseUrl}/images/generations` ||
          init?.method !== 'POST' ||
          body.model !== SEEDREAM_FLASH ||
          body.layer_decomposition !== true ||
          budget.requests >= 2
        )
          throw Error('本任务只允许最多2次Flash拆层请求，禁止重新生图或切换Pro');
        budget.requests++;
        paidPostsThisRun++;
        writeFileSync(budgetFile, JSON.stringify({ ...budget, limit: 2 }));
        const response = await fetch(url, { ...init, redirect: 'error' });
        if (!response.ok && arms) {
          const rejected = (await response.clone().json()) as { error?: { message?: string } };
          const message = rejected.error?.message
            ?.replaceAll(process.env.NYVEMI_ARK_API_KEY!, '[REDACTED]')
            .replace(/data:image\/[^\s]+/g, '[IMAGE]')
            .slice(0, 600);
          writeFileSync(
            resolve(root, `safe-error-${budget.requests}.json`),
            JSON.stringify({ status: response.status, message }),
          );
        }
        if (response.ok) {
          const data = (await response.clone().json()) as { data?: unknown[]; usage?: unknown };
          outputCount = data.data?.length ?? 0;
          usage = data.usage;
        }
        return response;
      }) as typeof fetch,
    );
    try {
      rig = await model.split({ uri: pathToFileURL(source).href, ...dimensions(source) });
      writeFileSync(resolve(root, 'rig.json'), JSON.stringify(rig, null, 2));
      const render = createRequire(import.meta.url)('../scripts/appearance/render-layers.cjs') as {
        renderRig(rig: CharacterRig, output: string): Preview;
      };
      preview = render.renderRig(rig, resolve(root, 'inspection'));
      for (const role of ['head', 'body', 'eyes', 'mouth']) {
        expect(
          preview.layers.some((l) => l.role === role && l.visible > 0 && l.transparent > 0),
        ).toBe(true);
      }
      const callsBeforeCache = budget.requests;
      expect(await model.split({ uri: pathToFileURL(source).href, ...dimensions(source) })).toEqual(
        rig,
      );
      expect(budget.requests).toBe(callsBeforeCache);
      const ds = new OpenAICompatibleProvider(
        { ...deepSeekPreset, model: process.env.NYVEMI_TEST_MODEL! },
        {
          get: async () => process.env.NYVEMI_TEST_API_KEY!,
          set: async () => {},
          remove: async () => {},
        },
        async (metric) => {
          metrics.push(metric);
        },
        (async (...args: Parameters<typeof fetch>) => {
          if (new URL(String(args[0])).origin !== 'https://api.deepseek.com' || ++dsCalls > 1)
            throw Error('最多1次DS静态核对');
          return fetch(...args);
        }) as typeof fetch,
      );
      const images = [
        source,
        preview.composite,
        preview.layers.find((l) => l.role === 'body')!.preview,
        preview.layers.find((l) => l.role === 'arm')!.preview,
      ];
      review = await ds.structuredVision(
        '依次是原立绘、图层按坐标静态重组结果、独立身体层、独立手臂层。头层必须是没有眼睛、嘴、头发的空白皮肤，这是正确拆层，不能把空白脸或没有头发判成缺陷；五官头发在另几层。重点核对重组的手臂/袖子有无重复、裸露新皮肤、错位，脖子肩膀连接是否连续。检查同一角色身份和装束是否保持，重组有无明显错位/白缝/重复眼嘴，头层应移除眼睛和嘴并补全皮肤，身体层应补全被头发和手臂挡住的衣服。棋盘格仅用于显示透明，不是角色背景。只能判断可见的静态结果，不宣称已验证动态或所有隐藏区域。严格输出JSON对象：{"identity":"match","layersUsable":true,"hiddenAreaQuality":"uncertain","issues":[],"summary":"简短说明"}。identity为match/uncertain/mismatch；hiddenAreaQuality为good/uncertain/bad；issues字符串数组；明显缺陷不能忽略。',
        await Promise.all(
          images.map((file) =>
            assets.dataUrl({ uri: pathToFileURL(file).href, ...dimensions(file) }),
          ),
        ),
        z
          .object({
            identity: z.enum(['match', 'uncertain', 'mismatch']),
            layersUsable: z.boolean(),
            hiddenAreaQuality: z.enum(['good', 'uncertain', 'bad']),
            issues: z.array(z.string().max(200)).max(10),
            summary: z.string().max(500),
          })
          .strict(),
        'visual_layer_review',
      );
      expect(review).toMatchObject({ identity: 'match', layersUsable: true });
    } catch (caught) {
      failure = caught instanceof ImageProviderError ? caught.failure : undefined;
      error = caught instanceof Error ? caught.message : '拆层验证未完成';
      throw caught;
    } finally {
      const receipts = await store.list('imageRequests');
      const cachedResponse = receipts.find((r) => r.response)?.response as
        | { data?: unknown[]; usage?: unknown }
        | undefined;
      outputCount ||= cachedResponse?.data?.length ?? 0;
      usage ??= cachedResponse?.usage;
      let report = JSON.stringify(
        {
          source,
          layerModel: SEEDREAM_FLASH,
          imageGenerationRequests: 0,
          requests: budget.requests,
          paidPostsThisRun,
          outputCount,
          usage,
          rig: rig
            ? {
                width: rig.width,
                height: rig.height,
                layers: rig.layers.map((l) => ({
                  role: l.role,
                  width: l.asset.width,
                  height: l.asset.height,
                })),
              }
            : undefined,
          preview,
          review,
          dsCalls,
          metrics,
          failure,
          error,
          receipts: (await store.list('imageRequests')).map((r) => ({
            id: r.id,
            status: r.status,
            error: r.error,
          })),
        },
        null,
        2,
      );
      for (const key of [process.env.NYVEMI_ARK_API_KEY, process.env.NYVEMI_TEST_API_KEY])
        if (key) report = report.replaceAll(key, '[REDACTED]');
      writeFileSync(resolve(root, 'result.json'), report);
    }
  },
  300000,
);
