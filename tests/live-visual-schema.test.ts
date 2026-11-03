import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DSVisualDirector } from '../src/appearance/research';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';

it.skipIf(process.env.NYVEMI_RUN_LIVE_VISUAL_SCHEMA !== '1')(
  'probes the reported uploaded-reference schema path without any drawing request',
  async () => {
    const root = resolve('artifacts/live-visual-schema');
    mkdirSync(root, { recursive: true });
    const key = process.env.NYVEMI_TEST_API_KEY!;
    if (!key) throw Error('缺少DS测试Key');
    const budgetFile = resolve(root, 'budget.json');
    const budget = existsSync(budgetFile)
      ? (JSON.parse(readFileSync(budgetFile, 'utf8')) as { requests: number })
      : { requests: 0 };
    const metrics: ApiMetric[] = [];
    const shapes: unknown[] = [];
    let research: unknown, error: string | undefined;
    const screenshot =
      '/var/folders/5n/br335dq15cbbx8kfgd60wty00000gn/T/codex-clipboard-794377e3-0b24-42d4-9c86-94af634ae8a4.jpg';
    if (!existsSync(screenshot))
      throw Error('原始上传图不可用，本测试需要用户提供的截图作为近似输入，不会付费生图');
    const model = new OpenAICompatibleProvider(
      { ...deepSeekPreset, model: process.env.NYVEMI_TEST_MODEL || deepSeekPreset.model },
      { get: async () => key, set: async () => {}, remove: async () => {} },
      async (m) => {
        metrics.push(m);
      },
      (async (url, init) => {
        if (String(url) !== 'https://api.deepseek.com/chat/completions' || init?.method !== 'POST')
          throw Error('只允许DS文字/识图请求，禁止生图');
        const cache = resolve(
          root,
          `${createHash('sha256').update(String(init?.body)).digest('hex')}.json`,
        );
        const request = JSON.parse(String(init?.body));
        const legacyBody = { ...request };
        delete legacyBody.response_format;
        const legacyCache = resolve(
          root,
          `${createHash('sha256').update(JSON.stringify(legacyBody)).digest('hex')}.json`,
        );
        let text: string;
        if (existsSync(cache)) text = readFileSync(cache, 'utf8');
        else if (existsSync(legacyCache)) text = readFileSync(legacyCache, 'utf8');
        else {
          if (!Number.isInteger(budget.requests) || budget.requests < 0 || budget.requests >= 4)
            throw Error('本轮最多4次DS请求；不重置原预算');
          budget.requests++;
          writeFileSync(budgetFile, JSON.stringify({ ...budget, limit: 4 }));
          expect(request.response_format).toEqual({ type: 'json_object' });
          const response = await fetch(url, { ...init, redirect: 'error' });
          if (!response.ok) return response;
          text = (await response.text()).replaceAll(key, '[REDACTED]');
          writeFileSync(cache, text);
        }
        const content = JSON.parse(text).choices?.[0]?.message?.content;
        try {
          const object = JSON.parse(content);
          shapes.push({
            keys: Object.keys(object),
            fields: Object.fromEntries(
              Object.entries(object).map(([k, v]) => [
                k,
                Array.isArray(v) ? `array(${v.length})` : typeof v,
              ]),
            ),
          });
        } catch {
          shapes.push({ json: false });
        }
        return new Response(text);
      }) as typeof fetch,
    );
    const noWeb = async (): Promise<never> => {
      throw Error('有用户参考，不应联网搜索');
    };
    const director = new DSVisualDirector(
      async () => model,
      { search: noWeb, read: noWeb, imageSearch: noWeb },
      {
        fingerprint: async () => 'provided-screenshot',
        dataUrl: async () =>
          `data:image/jpeg;base64,${readFileSync(screenshot).toString('base64')}`,
        download: noWeb,
        exists: async () => true,
      },
      async (s) => createHash('sha256').update(s).digest('hex'),
    );
    try {
      const input = {
        description: 'q版二次元孙颖莎蓝色衣服，黄色鞋子，短头发',
        mode: 'reference' as const,
        reference: { uri: screenshot, width: 864, height: 1920 },
      };
      const result = await director.research(input);
      research = result;
      expect(result.references).toHaveLength(1);
      expect(result.status).toBe('awaiting_reference');
      expect(result.references[0].check.status).toBe('match');
    } catch (caught) {
      error = caught instanceof Error ? caught.message : '测试失败';
      throw caught;
    } finally {
      writeFileSync(
        resolve(root, 'result.json'),
        JSON.stringify(
          {
            requests: budget.requests,
            imageGenerationRequests: 0,
            originalReferenceAvailable: false,
            note: 'Uses full user-provided screenshot as an approximate reference; original selected image is not available.',
            shapes,
            research,
            scope:
              'classification and uploaded-reference review; prompt compilation and drawing excluded',
            metrics,
            error,
          },
          null,
          2,
        ).replaceAll(key, '[REDACTED]'),
      );
    }
  },
  180000,
);
