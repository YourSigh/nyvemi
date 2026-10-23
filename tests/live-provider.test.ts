import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
import { PersonaInterview, interviewQuestions } from '../src/characters/interview';
import { CharacterService, defaultAnswers } from '../src/characters/service';
import { ChatService } from '../src/chat/service';
import { MemoryExtractionService } from '../src/memory/extraction';
import { HeartbeatEngine } from '../src/proactive/heartbeat/engine';
import { Diagnostics } from '../src/storage/diagnostics';
import { UsageLedger } from '../src/usage/ledger';
import { migrate, SQLiteStore } from '../src/storage/store';
import { TestDatabase } from './database';
import type { NotificationRecord } from '../src/domain/models';

it.skipIf(process.env.NYVEMI_RUN_LIVE !== '1' || process.env.NYVEMI_LIVE_FOCUS === 'memory')(
  'validates a bounded real DeepSeek interview/chat/memory/proactive flow',
  async () => {
    const db = new TestDatabase();
    await migrate(db);
    const store = new SQLiteStore(db);
    const ledger = new UsageLedger(db);
    const metrics: ApiMetric[] = [];
    const replies: string[] = [];
    const config = {
      ...deepSeekPreset,
      baseUrl: process.env.NYVEMI_TEST_BASE_URL!,
      model: process.env.NYVEMI_TEST_MODEL!,
    };
    const provider = new OpenAICompatibleProvider(
      config,
      {
        get: async () => process.env.NYVEMI_TEST_API_KEY!,
        set: async () => {},
        remove: async () => {},
      },
      async (m) => {
        metrics.push(m);
        await ledger.record(m);
      },
    );
    const getProvider = async () => provider;
    const diagnostics = new Diagnostics(store);
    const characters = new CharacterService(store, getProvider);
    const interview = new PersonaInterview(store, getProvider, characters);
    const delivered: NotificationRecord[] = [];
    let phase = 'connection';
    try {
      await provider.chat([{ role: 'user', content: 'Reply OK.' }], 'connection_test');
      phase = 'interview';
      const answers = {
        ...defaultAnswers,
        name: '小鲸测试',
        appearance: '清爽的成年同龄女孩，日常穿搭',
        interests: '科技、小众游戏',
        inspiration: '保留随意、有主见的风格',
      };
      for (const q of interviewQuestions) {
        const d = await interview.answer(answers[q.key] || '尊重彼此，不用刻意设定');
        expect(d.turns.at(-1)?.localFallback).toBe(false);
      }
      phase = 'persona';
      const c = await interview.finish();
      phase = 'chat';
      const chat = new ChatService(store, getProvider, diagnostics, undefined, async () => {});
      await chat.send(
        c.id,
        '今天上班烦死了。我最烦 AI 每句话最后问我要不要继续。下午还有个很重要的代码治理会议，晚上想跟你聊聊结果。',
        () => {},
      );
      const messages = await chat.history(c.id);
      replies.push(...messages.filter((m) => m.role === 'assistant').map((m) => m.content));
      expect(replies.length).toBeGreaterThan(0);
      phase = 'extraction';
      const extraction = new MemoryExtractionService(store, getProvider, diagnostics);
      await extraction.enqueue(
        c.id,
        messages.find((m) => m.role === 'user')!,
        messages.filter((m) => m.role === 'assistant'),
      );
      await extraction.drain();
      expect((await store.list('extractions', c.id))[0].status).toBe('done');
      expect((await store.list('memories', c.id)).some((m) => m.type === 'relationship')).toBe(
        true,
      );
      const intention = (await store.list('intentions', c.id))[0];
      expect(intention, 'real model should recognize the explicit follow-up topic').toBeDefined();
      phase = 'proactive';
      // Advance the isolated test clock inside the model-produced window. No change to device time or production policy.
      const now = intention.latestAt - 60000;
      const settings = (await store.get('settings', c.id))!;
      await store.put('settings', {
        ...settings,
        proactiveEnabled: true,
        quietStart: 0,
        quietEnd: 0,
        lastActiveAt: now - 6 * 3600000,
      });
      await store.put('intentions', { ...intention, importance: 1 });
      const heartbeat = new HeartbeatEngine(
        store,
        getProvider,
        {
          enabled: async () => true,
          show: async (n) => {
            delivered.push(n);
          },
          cancel: async () => {},
        },
        diagnostics,
        () => now,
      );
      await heartbeat.run();
      expect(delivered).toHaveLength(1);
      replies.push(delivered[0].body);
      await heartbeat.openNotification(delivered[0].id);
      expect(
        (await chat.history(c.id)).some((m) => m.origin === 'proactive' && m.status === 'complete'),
      ).toBe(true);
      expect(metrics.length).toBeLessThanOrEqual(18);
      expect((await ledger.summary()).reduce((n, r) => n + r.requests, 0)).toBe(metrics.length);
      phase = 'passed';
    } finally {
      mkdirSync('artifacts', { recursive: true });
      const summary = {
        phase,
        model: config.model,
        requests: metrics.length,
        usage: await ledger.summary(),
        replies,
        memories: await store.list('memories'),
        intentions: await store.list('intentions'),
        evidence:
          'Real HTTP provider + isolated SQLite; notification gateway is a test double. Not Android delivery or elapsed-background acceptance.',
      };
      writeFileSync('artifacts/live-provider-result.json', JSON.stringify(summary, null, 2));
      console.info(
        `真实模型验收阶段：${phase}；请求 ${metrics.length} 次。结果位于 artifacts/live-provider-result.json（无密钥）。`,
      );
    }
  },
  900000,
);

it.skipIf(process.env.NYVEMI_RUN_LIVE !== '1' || process.env.NYVEMI_LIVE_FOCUS !== 'memory')(
  'inspects real model preference extraction with one request',
  async () => {
    const db = new TestDatabase();
    await migrate(db);
    const store = new SQLiteStore(db);
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
      async () => {},
      async (input, init) => {
        const response = await fetch(input, init);
        const body = (await response.clone().json()) as {
          choices?: { message?: { content?: string } }[];
        };
        mkdirSync('artifacts', { recursive: true });
        writeFileSync(
          'artifacts/live-memory-raw.json',
          JSON.stringify({ content: body.choices?.[0]?.message?.content }, null, 2),
        );
        return response;
      },
    );
    const c = await new CharacterService(store, async () => provider).create(
      { ...defaultAnswers, name: '测试桶砸' },
      true,
    );
    const user = {
      id: 'test-user',
      characterId: c.id,
      role: 'user' as const,
      content:
        '今天上班烦死了。我最烦 AI 每句话最后问我要不要继续。下午还有个很重要的代码治理会议，晚上想跟你聊聊结果。',
      createdAt: Date.now(),
      origin: 'chat' as const,
      status: 'complete' as const,
    };
    await store.put('messages', user);
    const extraction = new MemoryExtractionService(
      store,
      async () => provider,
      new Diagnostics(store),
    );
    await extraction.enqueue(c.id, user, []);
    await extraction.drain();
    mkdirSync('artifacts', { recursive: true });
    writeFileSync(
      'artifacts/live-memory-result.json',
      JSON.stringify(
        {
          memories: await store.list('memories'),
          intentions: await store.list('intentions'),
          jobs: await store.list('extractions'),
          persona: (await store.get('characters', c.id))?.persona,
        },
        null,
        2,
      ),
    );
    expect((await store.list('memories')).some((m) => m.type === 'relationship')).toBe(true);
  },
  120000,
);
