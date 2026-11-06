import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { understandName } from '../src/characters/name';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
it.skipIf(process.env.NYVEMI_RUN_LIVE_HATCHING !== '1')(
  'understands real naming utterances without copying naming syntax',
  async () => {
    let requests = 0;
    const metrics: ApiMetric[] = [];
    const provider = new OpenAICompatibleProvider(
      {
        ...deepSeekPreset,
        baseUrl: process.env.NYVEMI_TEST_BASE_URL!,
        model: process.env.NYVEMI_TEST_MODEL!,
        thinking: false,
      },
      {
        get: async () => process.env.NYVEMI_TEST_API_KEY!,
        set: async () => {},
        remove: async () => {},
      },
      async (m) => {
        metrics.push(m);
      },
      (async (...args: Parameters<typeof fetch>) => {
        if (++requests > 6) throw Error('name verification request limit');
        const response = await fetch(...args);
        const body = (await response.clone().json()) as {
          choices?: { message?: { content?: string } }[];
        };
        writeFileSync(
          'artifacts/live-hatching-last-response.json',
          JSON.stringify({ content: body.choices?.[0]?.message?.content }, null, 2),
        );
        return response;
      }) as typeof fetch,
    );
    const cases: { input: string; expected?: string | null }[] = [
      { input: '叫桶砸吧', expected: '桶砸' },
      { input: '不是小雨，改叫星野', expected: '星野' },
      { input: '我想叫你“吧吧”，这两个吧就是名字', expected: '吧吧' },
      { input: '不喜欢小小这个名字', expected: null },
      { input: '那你帮自己取一个吧' },
      { input: '名字就用林一好了', expected: '林一' },
    ];
    const results = [];
    for (const item of cases) {
      const reply = await understandName(async () => provider, item.input);
      results.push({ ...item, reply });
      if ('expected' in item) expect(reply.name).toBe(item.expected);
      else expect(reply.name?.length).toBeGreaterThan(0);
      if (reply.name === null) expect(reply.clarification).toBeTruthy();
    }
    writeFileSync(
      'artifacts/live-hatching-name-0.19.1.json',
      JSON.stringify({ requests, results, metrics }, null, 2),
    );
  },
  150000,
);
