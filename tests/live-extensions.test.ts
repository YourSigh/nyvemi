import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { CompanionAgent } from '../src/agent/service';
import { PluginManager } from '../src/extensions/manager';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
import { ChatService } from '../src/chat/service';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { Diagnostics } from '../src/storage/diagnostics';
import { demoPersona, defaultSettings } from '../src/domain/models';
it.skipIf(process.env.NYVEMI_RUN_LIVE_EXTENSIONS !== '1')(
  'real DeepSeek composes and persists a reusable plugin without scripted tool selection',
  async () => {
    const db = new TestDatabase();
    await migrate(db);
    const store = new SQLiteStore(db),
      cid = 'live-extensions';
    await store.put('characters', {
      id: cid,
      persona: demoPersona(cid),
      state: { energy: 0.7, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
      interests: [],
      createdAt: 1,
    });
    await store.put('settings', defaultSettings(cid));
    let calls = 0;
    const metrics: ApiMetric[] = [];
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
        if (++calls > 14) throw Error('live_request_budget');
        return fetch(...args);
      },
    );
    const loader = {
        load: async () => {
          throw Error('此测试不下载插件');
        },
        hash: async () => 'unused',
      },
      plugins = new PluginManager(store, loader),
      diag = new Diagnostics(store);
    const create = () =>
      new CompanionAgent(store, async () => provider, diag, {
        plugins,
        web: {
          search: async () => {
            throw Error('此测试不联网搜索');
          },
          read: async () => {
            throw Error('此测试不读网页');
          },
          bilibili: async () => [],
        },
        notifications: { enabled: async () => true, show: async () => {}, cancel: async () => {} },
        visible: () => true,
        clock: () => '',
        model: async () => process.env.NYVEMI_TEST_MODEL!,
        schedule: async () => {},
        redact: async (x) => x,
        pause: async () => {},
      });
    let agent = create();
    const chat = new ChatService(store, async () => provider, diag, {
      agent: (input) => agent.run(input),
      retrieve: async () => [],
      afterRound: async () => {},
    });
    try {
      await chat.send(
        cid,
        '给自己组合一个以后可以重复用的“找阅读资料”工具：输入topic，调用现有web_search并返回结果。用插件保存，先不要真的搜索。另外记住“先给结论，再给来源”的做事方法，作为以后可用的技能。',
        () => {},
      );
      expect((await plugins.list(cid)).some((p) => p.manifest.tools.length > 0)).toBe(true);
      agent = create();
      await chat.send(cid, '你刚才给自己保存了什么方法？不用搜索，简短告诉我。', () => {});
      expect(
        (await new PluginManager(store, loader).list(cid)).some(
          (p) => p.manifest.instructions.length > 0,
        ),
      ).toBe(true);
    } finally {
      writeFileSync(
        'artifacts/live-extensions.json',
        JSON.stringify(
          {
            calls,
            usage: metrics.map((m) => ({
              inputTokens: m.inputTokens,
              outputTokens: m.outputTokens,
              success: m.success,
            })),
            plugins: await plugins.list(cid),
            messages: (await chat.history(cid)).map((m) => ({ role: m.role, content: m.content })),
            tools: (await store.list('diagnostics', cid, 200))
              .filter((d) => d.data.event === 'agent_tool')
              .map((d) => d.data),
          },
          null,
          2,
        ),
      );
    }
  },
  240000,
);
