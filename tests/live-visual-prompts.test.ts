import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DSVisualDirector } from '../src/appearance/research';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';

it.skipIf(process.env.NYVEMI_RUN_LIVE_VISUAL_PROMPTS !== '1')(
  'validates original routing and DS-authored drawing prompts with zero image requests',
  async () => {
    const root = resolve('artifacts/live-visual-prompts');
    mkdirSync(root, { recursive: true });
    const key = process.env.NYVEMI_TEST_API_KEY!;
    if (!key) throw Error('缺少DS测试Key');
    const budgetFile = resolve(root, 'budget.json');
    const budget = existsSync(budgetFile)
      ? (JSON.parse(readFileSync(budgetFile, 'utf8')) as { requests: number })
      : { requests: 0 };
    const metrics: ApiMetric[] = [];
    const cases: unknown[] = [];
    let webCalls = 0;
    const model = new OpenAICompatibleProvider(
      { ...deepSeekPreset, model: process.env.NYVEMI_TEST_MODEL || deepSeekPreset.model },
      { get: async () => key, set: async () => {}, remove: async () => {} },
      async (m) => {
        metrics.push(m);
      },
      (async (url, init) => {
        if (String(url) !== 'https://api.deepseek.com/chat/completions' || init?.method !== 'POST')
          throw Error('只允许DS文字请求，禁止生图/拆层');
        const cache = resolve(
          root,
          `${createHash('sha256').update(String(init?.body)).digest('hex')}.json`,
        );
        if (existsSync(cache)) return new Response(readFileSync(cache, 'utf8'));
        if (!Number.isInteger(budget.requests) || budget.requests < 0 || budget.requests >= 6)
          throw Error('本轮最多6次DS请求；不会重置预算');
        budget.requests++;
        writeFileSync(budgetFile, JSON.stringify({ ...budget, limit: 6 }));
        const response = await fetch(url, { ...init, redirect: 'error' });
        if (response.ok)
          writeFileSync(cache, (await response.clone().text()).replaceAll(key, '[REDACTED]'));
        return response;
      }) as typeof fetch,
    );
    const noWeb = async (): Promise<never> => {
      webCalls++;
      throw Error('原创不允许联网搜索');
    };
    const director = new DSVisualDirector(
      async () => model,
      { search: noWeb, read: noWeb, imageSearch: noWeb },
      {
        fingerprint: async () => 'unused',
        dataUrl: async () => {
          throw Error('本测试不读图');
        },
        download: noWeb,
        exists: async () => false,
      },
      async (s) => createHash('sha256').update(s).digest('hex'),
    );
    try {
      for (const description of [
        '原创角色云芽，短蓝发，灰色连体工作服，机械师，Q版。',
        '橙色短发、圆眼镜、深蓝西装的爵士乐手，Q版。',
      ]) {
        const input = { description, mode: 'text' as const };
        const plan = await director.research(input);
        expect(plan).toMatchObject({
          status: 'ready',
          references: [],
          brief: { namedCharacter: false },
        });
        const prompt = await director.composePrompt({ ...input, brief: plan.brief });
        cases.push({ description, brief: plan.brief, prompt });
        for (const feature of description.includes('机械师')
          ? ['蓝', '灰', '机械']
          : ['橙', '圆', '眼镜', '爵士'])
          expect(prompt).toContain(feature);
      }
      const known = { description: 'q版的原神纳西妲，可爱一点', mode: 'text' as const };
      const plan = await director.classify(known);
      expect(plan.brief.namedCharacter).toBe(true);
      expect(plan.queries.length).toBeGreaterThan(0);
      // Compiler-only known-character probe. These observations are a fixture, not newly searched evidence.
      const prompt = await director.composePrompt({
        ...known,
        reference: { uri: 'fixture:confirmed-reference', width: 1024, height: 1024 },
        brief: { ...plan.brief, recognizableFeatures: ['银白色头发', '绿色眼睛', '白绿服装'] },
      });
      expect(prompt).toContain('纳西妲');
      cases.push({
        ...known,
        brief: plan.brief,
        prompt,
        observationsSource: 'test fixture; public search covered by offline integration tests',
      });
      expect(webCalls).toBe(0);
    } finally {
      writeFileSync(
        resolve(root, 'result.json'),
        JSON.stringify(
          { requests: budget.requests, imageRequests: 0, webCalls, cases, metrics },
          null,
          2,
        ).replaceAll(key, '[REDACTED]'),
      );
    }
  },
  240000,
);
