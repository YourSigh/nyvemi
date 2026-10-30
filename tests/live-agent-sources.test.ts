import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { PublicAgentWeb } from '../src/agent/web';
import { BilibiliContentProvider } from '../src/exploration/content';
it.skipIf(process.env.NYVEMI_PROBE_AGENT_SOURCES !== '1')(
  'probes public sources without a model call',
  async () => {
    const web = new PublicAgentWeb(new BilibiliContentProvider());
    const probe = async (work: () => Promise<unknown[]>) => {
      try {
        const items = await work();
        return { ok: true, count: items.length, sample: items.slice(0, 1) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'source unavailable' };
      }
    };
    const search = await probe(() => web.search('Expo EAS Build'));
    const bilibili = await probe(() => web.bilibili('机器人'));
    writeFileSync(
      'artifacts/dsh-public-sources.json',
      JSON.stringify({ at: new Date().toISOString(), search, bilibili }, null, 2),
    );
  },
  60000,
);
