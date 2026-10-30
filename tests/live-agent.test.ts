import { expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CompanionAgent, type AgentHost } from '../src/agent/service';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
import { ChatService } from '../src/chat/service';
import { Diagnostics } from '../src/storage/diagnostics';
import { SQLiteStore, migrate } from '../src/storage/store';
import { serializeDatabase } from '../src/storage/serialized';
import { TestDatabase } from './database';
import { demoPersona, defaultSettings } from '../src/domain/models';
import { localTimeContext } from '../src/chat/prompt';
import { PublicAgentWeb } from '../src/agent/web';
import { BilibiliContentProvider } from '../src/exploration/content';
it.skipIf(process.env.NYVEMI_RUN_LIVE_AGENT !== '1')(
  'validates the embedded DSH with real DeepSeek, tools, silence and a cold background wake',
  async () => {
    const db = serializeDatabase(new TestDatabase());
    await migrate(db);
    const store = new SQLiteStore(db);
    await store.put('characters', {
      id: 'live-agent',
      persona: demoPersona('live-agent'),
      state: { energy: 0.7, relationshipCloseness: 0.3, recentFocus: [], curiosityTopics: [] },
      interests: [],
      createdAt: Date.now(),
    });
    await store.put('settings', {
      ...defaultSettings('live-agent'),
      proactiveEnabled: true,
      quietStart: 0,
      quietEnd: 0,
    });
    let requests = 0,
      visible = true;
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
        if (++requests > 24) throw Error('live_request_budget');
        return fetch(...args);
      },
    );
    const host: AgentHost = {
      web: new PublicAgentWeb(new BilibiliContentProvider()),
      notifications: {
        enabled: async () => true,
        show: async (n) => {
          notifications.push(n.body);
        },
        cancel: async () => {},
      },
      visible: () => visible,
      model: async () => process.env.NYVEMI_TEST_MODEL!,
      clock: () => localTimeContext(Date.now()),
      schedule: async () => {},
      redact: async (x) => x,
      pause: async () => {},
    };
    const diagnostics = new Diagnostics(store);
    const agent = new CompanionAgent(store, async () => provider, diagnostics, host);
    const chat = new ChatService(store, async () => provider, diagnostics, {
      agent: (input) => agent.run(input),
      retrieve: async () => [],
      afterRound: async () => {},
    });
    const rounds: { user: string; messages: string[] }[] = [];
    const send = async (text: string) => {
      const before = new Set((await chat.history('live-agent')).map((m) => m.id));
      await chat.send('live-agent', text, () => {});
      const messages = (await chat.history('live-agent'))
        .filter((m) => m.role === 'assistant' && !before.has(m.id))
        .map((m) => m.content);
      rounds.push({ user: text, messages });
      return messages;
    };
    try {
      expect(await send('先别说话，我还没想好说什么，不用回复我。')).toEqual([]);
      expect(await send('。')).toEqual([]);
      expect((await send('可以说话了，17乘23等于多少？算完不用追问我。')).join('')).toContain(
        '391',
      );
      await send('芜湖，一分钟后随便给我发一条消息吧，我现在退到后台测试通知。');
      const task = (await store.list('intentions', 'live-agent')).find(
        (i) => i.type === 'requested' && i.status === 'pending',
      );
      expect(task).toBeDefined();
      expect(task!.agentWakeup).toBe(true);
      visible = false;
      const realNow = Date.now.bind(Date),
        dueTime = Math.max(realNow(), task!.earliestAt + 1000);
      const time = vi.spyOn(Date, 'now').mockImplementation(() => dueTime);
      try {
        const cold = new CompanionAgent(store, async () => provider, diagnostics, host);
        await cold.due(undefined, task!.id);
      } finally {
        time.mockRestore();
      }
      expect(notifications.length).toBeGreaterThan(0);
      expect((await store.get('intentions', task!.id))?.status).toBe('completed');
      visible = true;
      await send(
        '帮我真的读一下 https://docs.expo.dev/build/introduction/ 这个公开网页，告诉我它的标题和大概讲什么；读不到就直说，不用再搜索其它网站。',
      );
      const logs = await store.list('diagnostics', 'live-agent', 200);
      expect(logs.some((d) => d.data.event === 'agent_tool' && d.data.name === 'web_fetch')).toBe(
        true,
      );
    } finally {
      const logs = await store.list('diagnostics', 'live-agent', 200);
      const session = await store.get('agentSessions', 'live-agent');
      const actionCalls = session?.events
        .filter((e): e is { type: string; data: { name: string; arguments: string } } =>
          Boolean(e && typeof e === 'object' && 'type' in e && e.type === 'tool/call'),
        )
        .map((e) => ({ name: e.data.name, arguments: JSON.parse(e.data.arguments) }));
      const report = {
        actionCalls,
        model: process.env.NYVEMI_TEST_MODEL,
        rounds,
        notifications,
        requests,
        usage: metrics.map((m) => ({
          purpose: m.purpose,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          duration: m.duration,
          success: m.success,
        })),
        tools: logs.filter((d) => d.data.event === 'agent_tool').map((d) => d.data),
        backgroundValidation:
          'New CompanionAgent instance with persisted SQLite session; due time advanced logically. No physical Android/WorkManager execution claimed.',
      };
      mkdirSync('artifacts', { recursive: true });
      writeFileSync('artifacts/live-dsh-agent.json', JSON.stringify(report, null, 2));
    }
  },
  600000,
);
