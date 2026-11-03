import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ThemeService } from '../src/theme/service';
import { generatePalette, contrast } from '../src/theme/generator';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
it.skipIf(process.env.NYVEMI_RUN_LIVE_THEME !== '1')(
  'understands one abstract theme through real DeepSeek and reuses the result',
  async () => {
    const db = new TestDatabase();
    await migrate(db);
    const store = new SQLiteStore(db),
      metrics: ApiMetric[] = [];
    let requests = 0;
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
      async (metric) => {
        metrics.push(metric);
      },
      (async (...args: Parameters<typeof fetch>) => {
        if (++requests > 1) throw Error('live theme request budget');
        return fetch(...args);
      }) as typeof fetch,
    );
    const service = new ThemeService(store, async () => provider);
    const input = '像雨后石板路反着路灯的光，干净克制。不要粉色和糖果感。';
    const chosen = await service.interpret(input);
    expect(chosen.source).toBe('model');
    expect(chosen.preference.base).not.toBe('pink');
    const palette = generatePalette(chosen.preference);
    expect(contrast(palette.ink, palette.background)).toBeGreaterThanOrEqual(4.5);
    await service.completeOpening(chosen);
    expect(await service.interpret(input)).toEqual(chosen);
    expect(requests).toBe(1);
    writeFileSync(
      'artifacts/live-theme.json',
      JSON.stringify({ requests, chosen, palette, metrics }, null, 2),
    );
  },
  15000,
);
