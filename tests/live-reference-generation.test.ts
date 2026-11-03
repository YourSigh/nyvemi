import { ImageProviderError } from '../src/appearance/errors';
import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { SeedreamImageProvider, referenceGenerationPrompt } from '../src/appearance/seedream';
import { defaultImageSettings, type ImageAsset, type VisualInput } from '../src/appearance/model';
import { DSVisualDirector, type VisualResearch } from '../src/appearance/research';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { publicUrl } from '../src/agent/web';
import type { ImageAssets } from '../src/appearance/service';
it.skipIf(process.env.NYVEMI_RUN_LIVE_REFERENCE_GENERATION !== '1')(
  'validates the shipped reference generation with one persistent paid request maximum and no decomposition',
  async () => {
    const root = resolve('artifacts/live-reference-generation');
    mkdirSync(root, { recursive: true });
    const evidence = JSON.parse(readFileSync('artifacts/live-visual-research.json', 'utf8')) as {
      outcome: { result: VisualResearch };
    };
    const research = evidence.outcome.result;
    const reference = research.references[0];
    if (!reference || reference.check.status !== 'match') throw Error('缺少已经核对并选定的参考图');
    const hash = async (text: string) => createHash('sha256').update(text).digest('hex');
    const diskPath = (a: ImageAsset) => (a.uri.startsWith('file:') ? fileURLToPath(a.uri) : a.uri);
    const dimensions = (file: string) => {
      const info = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
        encoding: 'utf8',
      });
      const width = Number(/pixelWidth:\s*(\d+)/.exec(info)?.[1]);
      const height = Number(/pixelHeight:\s*(\d+)/.exec(info)?.[1]);
      if (!width || !height) throw Error('无法读取生成图片尺寸');
      return { width, height };
    };
    const assets: ImageAssets = {
      exists: async (a) => existsSync(diskPath(a)),
      fingerprint: async (a) => hash(readFileSync(diskPath(a)).toString('base64')),
      dataUrl: async (a) => {
        const bytes = readFileSync(diskPath(a));
        return `data:image/${bytes[0] === 137 ? 'png' : bytes[0] === 255 ? 'jpeg' : 'webp'};base64,${bytes.toString('base64')}`;
      },
      download: async (input, key) => {
        const file = resolve(root, `${key}.image`);
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
              if (!location) throw Error('下载跳转无地址');
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
            throw Error('图片下载失败，付费响应保留');
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length > 12 * 1024 * 1024) throw Error('图片过大，付费响应保留');
          writeFileSync(file, bytes);
        }
        return { uri: pathToFileURL(file).href, ...dimensions(file) };
      },
    };
    const database = new TestDatabase(resolve(root, 'cache.sqlite'));
    await migrate(database);
    const store = new SQLiteStore(database);
    const budgetFile = resolve(root, 'budget.json');
    const budget: { requests: number; limit: number } = existsSync(budgetFile)
      ? JSON.parse(readFileSync(budgetFile, 'utf8'))
      : { requests: 0, limit: 1 };
    const input: VisualInput = {
      mode: 'text',
      description: 'q版的原神纳西妲，可爱一点',
      reference: reference.asset,
      brief: { ...research.brief, recognizableFeatures: reference.check.features },
      promptVersion: 3,
      generationId: 'approved-reference-once-2026-11-03',
    };
    let output: ImageAsset | undefined;
    let review: unknown;
    let imageUsage: unknown;
    let safeError: string | undefined;
    let failure: unknown;
    let dsRequests = 0;
    const metrics: ApiMetric[] = [];
    const provider = new SeedreamImageProvider(
      defaultImageSettings,
      async () => process.env.NYVEMI_ARK_API_KEY!,
      store,
      assets,
      hash,
      (async (url, init) => {
        const address = new URL(String(url));
        if (
          address.href !== `${defaultImageSettings.baseUrl}/images/generations` ||
          init?.method !== 'POST' ||
          budget.requests >= 1
        )
          throw Error('单次生图请求额度已用完，禁止自动重发');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (
          body.layer_decomposition ||
          body.model !== defaultImageSettings.imageModel ||
          body.prompt !== referenceGenerationPrompt(input, 0) ||
          typeof body.image !== 'string'
        )
          throw Error('本次授权只允许生产参数的单张参考生图');
        budget.requests++;
        writeFileSync(budgetFile, JSON.stringify({ ...budget, limit: 1 }));
        const response = await fetch(url, { ...init, redirect: 'error' });
        if (response.ok) {
          const payload = (await response.clone().json()) as { usage?: unknown };
          imageUsage = payload.usage;
        }
        return response;
      }) as typeof fetch,
    );
    try {
      output = await provider.candidate(input, 0);
      const model = new OpenAICompatibleProvider(
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
          if (new URL(String(args[0])).origin !== 'https://api.deepseek.com' || ++dsRequests > 1)
            throw Error('DS核对只允许一次，不自动重试');
          return fetch(...args);
        }) as typeof fetch,
      );
      const director = new DSVisualDirector(
        async () => model,
        {
          search: async () => [],
          read: async () => {
            throw Error('复用参考，不重新搜索');
          },
        },
        assets,
        hash,
      );
      review = await director.review(input, output);
      expect(review).toMatchObject({ status: 'match' });
      expect(budget.requests).toBe(1);
      // A repeated call must use the exact durable result, not spend a second request.
      expect(await provider.candidate(input, 0)).toEqual(output);
    } catch (error) {
      safeError = error instanceof Error ? error.message : '验证未完成';
      failure = error instanceof ImageProviderError ? error.failure : undefined;
      throw error;
    } finally {
      const report = {
        model: defaultImageSettings.imageModel,
        prompt: referenceGenerationPrompt(input, 0),
        input: {
          description: input.description,
          reference: reference.asset,
          source: reference.sourceUrl,
          features: reference.check.features,
        },
        imageRequests: budget.requests,
        decompositionRequests: 0,
        imageUsage,
        output,
        review,
        dsRequests,
        metrics,
        error: safeError,
        failure,
        receipts: (await store.list('imageRequests')).map((r) => ({
          id: r.id,
          status: r.status,
          error: r.error,
        })),
      };
      const keys = [process.env.NYVEMI_ARK_API_KEY, process.env.NYVEMI_TEST_API_KEY].filter(
        (key): key is string => Boolean(key),
      );
      let text = JSON.stringify(report, null, 2);
      for (const key of keys) text = text.replaceAll(key, '[REDACTED]');
      writeFileSync(resolve(root, 'result.json'), text);
    }
  },
  240000,
);
