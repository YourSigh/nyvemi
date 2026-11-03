import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { mobileAgentRunner } from './mobile-runtime';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
import { planVisualBrief } from '../src/appearance/brief';
import { ThemeService } from '../src/theme/service';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { agentTools } from '../src/agent/tools';
it.skipIf(process.env.NYVEMI_RUN_LIVE_APPEARANCE_CHAT !== '1')(
  'plans identity and runs a green-theme/chat round in the embedded mobile-profile DSH',
  async () => {
    const db = new TestDatabase();
    await migrate(db);
    const store = new SQLiteStore(db),
      metrics: ApiMetric[] = [],
      sent: string[] = [];
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
      async (m) => {
        metrics.push(m);
      },
      (async (...args: Parameters<typeof fetch>) => {
        if (++requests > (process.env.NYVEMI_LIVE_IDENTITY_ONLY === '1' ? 1 : 8))
          throw Error('live repair request budget');
        return fetch(...args);
      }) as typeof fetch,
    );
    const brief = await planVisualBrief(
      'Q版原神纳西妲，保留原本发型、绿眼睛和白绿服装',
      async () => provider,
    );
    expect(brief?.namedCharacter).toBe(true);
    expect(brief?.subject).toContain('纳西妲');
    if (process.env.NYVEMI_LIVE_IDENTITY_ONLY === '1') {
      expect(
        brief?.recognizableFeatures.every((feature) =>
          'Q版原神纳西妲，保留原本发型、绿眼睛和白绿服装'.includes(feature),
        ),
      ).toBe(true);
      writeFileSync(
        'artifacts/live-appearance-identity-verified.json',
        JSON.stringify({ requests, brief, metrics }, null, 2),
      );
      return;
    }
    const themes = new ThemeService(store, async () => provider),
      run = mobileAgentRunner();
    let applied = 0;
    const execute = async (name: string, raw: unknown) => {
      const args = raw as { description?: string; messages?: string[] };
      if (name === 'change_theme') {
        await themes.save(await themes.interpret(args.description!));
        applied++;
        return { applied: true };
      }
      if (name === 'send_message') {
        sent.push(...args.messages!);
        return { sent: true };
      }
      if (name === 'wait') return { waiting: true };
      throw Error('本次测试无需该工具');
    };
    const first = await run(
      {
        id: 'live-repair',
        model: process.env.NYVEMI_TEST_MODEL!,
        system:
          '你是一个自然随意的聊天角色。只有send_message才发送聊天气泡，普通文本留在内部。用户明确要求换色就使用change_theme，成功后自然简短回应，随后wait结束。不使用无关工具。',
        text: '换成淡绿色主题',
        maxSteps: 6,
        timeoutMs: 60000,
        tools: agentTools,
      },
      {
        generate: (request, signal) => provider.toolChat(request, signal),
        checkpoint: async () => {},
        execute,
      },
    );
    expect(applied).toBe(1);
    expect((await themes.load())?.preference.base).toBe('mint');
    const before = sent.length;
    await run(
      {
        id: 'live-repair',
        model: process.env.NYVEMI_TEST_MODEL!,
        system: '自然聊天，使用send_message发送回复，之后wait。普通文字不会显示。',
        text: '17乘23是多少？算完别追问',
        seed: first.events,
        maxSteps: 5,
        timeoutMs: 60000,
        tools: agentTools,
      },
      {
        generate: (request, signal) => provider.toolChat(request, signal),
        checkpoint: async () => {},
        execute,
      },
    );
    expect(sent.slice(before).join('')).toContain('391');
    writeFileSync(
      'artifacts/live-appearance-chat.json',
      JSON.stringify(
        {
          requests,
          brief,
          applied,
          theme: await themes.load(),
          sent,
          metrics,
          limits:
            'No Ark call or physical-device test; native-like VM with real RN AbortController and embedded DSH.',
        },
        null,
        2,
      ),
    );
  },
  150000,
);
