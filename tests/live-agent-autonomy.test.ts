import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { CompanionAgent } from '../src/agent/service';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
import { Diagnostics } from '../src/storage/diagnostics';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona, defaultSettings } from '../src/domain/models';
import { localTimeContext } from '../src/chat/prompt';
import { PublicAgentWeb } from '../src/agent/web';
import { BilibiliContentProvider } from '../src/exploration/content';
it.skipIf(process.env.NYVEMI_RUN_LIVE_AUTONOMY !== '1')(
  'observes one real free-time activity without a user request or scripted tool choice',
  async () => {
    const db = new TestDatabase();
    await migrate(db);
    const store = new SQLiteStore(db),
      cid = 'autonomy';
    await store.put('characters', {
      id: cid,
      persona: demoPersona(cid),
      state: { energy: 0.7, relationshipCloseness: 0.3, recentFocus: [], curiosityTopics: [] },
      interests: [
        { topic: 'robotics', score: 0.5, source: 'initial', updatedAt: Date.now() - 86400000 },
      ],
      createdAt: Date.now(),
    });
    await store.put('settings', {
      ...defaultSettings(cid),
      lastActiveAt: Date.now() - 86400000,
      proactiveEnabled: true,
      quietStart: 0,
      quietEnd: 0,
    });
    let requests = 0;
    const metrics: ApiMetric[] = [],
      notifications: string[] = [];
    const provider = new OpenAICompatibleProvider(
      {
        ...deepSeekPreset,
        baseUrl: process.env.NYVEMI_TEST_BASE_URL!,
        model: process.env.NYVEMI_TEST_MODEL!,
      },
      {
        get: async () => process.env.NYVEMI_TEST_API_KEY!,
        set: async () => {},
        remove: async () => {},
      },
      async (m) => {
        metrics.push(m);
      },
      async (...args) => {
        if (++requests > 8) throw Error('live_request_budget');
        return fetch(...args);
      },
    );
    const agent = new CompanionAgent(store, async () => provider, new Diagnostics(store), {
      web: new PublicAgentWeb(new BilibiliContentProvider()),
      notifications: {
        enabled: async () => true,
        show: async (n) => {
          notifications.push(n.body);
        },
        cancel: async () => {},
      },
      visible: () => false,
      clock: () => localTimeContext(),
      model: async () => process.env.NYVEMI_TEST_MODEL!,
      schedule: async () => {},
      redact: async (x) => x,
    });
    await agent.heartbeat();
    const session = await store.get('agentSessions', cid),
      logs = await store.list('diagnostics', cid, 200);
    writeFileSync(
      'artifacts/live-dsh-autonomy.json',
      JSON.stringify(
        {
          model: process.env.NYVEMI_TEST_MODEL,
          requests,
          usage: metrics.map((m) => ({
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            success: m.success,
          })),
          status: session?.lastRunStatus,
          tools: logs.filter((d) => d.data.event === 'agent_tool').map((d) => d.data),
          experiences: await store.list('experiences', cid),
          intentions: await store.list('intentions', cid),
          notifications,
        },
        null,
        2,
      ),
    );
    expect(requests).toBeGreaterThan(0);
    expect(session?.lastRunStatus).toBe('complete');
  },
  180000,
);
