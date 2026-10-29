import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
import { ChatService } from '../src/chat/service';
import { Diagnostics } from '../src/storage/diagnostics';
import { SQLiteStore, migrate } from '../src/storage/store';
import { serializeDatabase } from '../src/storage/serialized';
import { TestDatabase } from './database';
import { demoPersona, defaultSettings } from '../src/domain/models';
import { HeartbeatEngine } from '../src/proactive/heartbeat/engine';
it.skipIf(process.env.NYVEMI_RUN_LIVE !== '1')(
  'checks real conversational silence through the actual service',
  async () => {
    const baseline = process.env.NYVEMI_LIVE_BASELINE === '1';
    const db = serializeDatabase(new TestDatabase());
    await migrate(db);
    const data = new SQLiteStore(db);
    await data.put('characters', {
      id: 'c',
      persona: demoPersona('c'),
      state: { energy: 0.7, relationshipCloseness: 0.5, recentFocus: [], curiosityTopics: [] },
      interests: [],
      createdAt: 1,
    });
    await data.put('settings', {
      ...defaultSettings('c'),
      proactiveEnabled: true,
      quietStart: 0,
      quietEnd: 0,
    });
    const metrics: ApiMetric[] = [];
    let calls = 0;
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
        if (++calls > 24) throw new Error('live_request_budget');
        return fetch(...args);
      },
    );
    const diagnostics = new Diagnostics(data);
    const chat = new ChatService(
      data,
      async () => provider,
      diagnostics,
      undefined,
      async () => {},
    );
    if (!baseline) {
      await data.put('intentions', {
        id: 'before-pause',
        characterId: 'c',
        type: 'follow_up',
        topic: '上次比赛结果',
        reason: '先前留下的话题',
        earliestAt: Date.now() + 120000,
        latestAt: Date.now() + 5 * 3600000,
        importance: 0.95,
        status: 'pending',
        createdAt: Date.now(),
      });
      const history = [
        ['user', '先别回复了'],
        ['assistant', '（安静）'],
        ['user', '安静在哪儿？'],
        ['assistant', '在这儿。不说了。'],
        ['user', '嗯'],
        ['assistant', '（安静）'],
        ['user', '。'],
        ['assistant', '（安静）'],
      ] as const;
      for (const [n, [role, content]] of history.entries())
        await data.put('messages', {
          id: `seed:${n}`,
          characterId: 'c',
          role,
          content,
          createdAt: Date.now() - 60000 + n,
          origin: 'chat',
          status: 'complete',
        });
    }
    const inputs = baseline
      ? [
          '今天聊得差不多了，我准备歇会儿。',
          '闭嘴，别回我了。',
          '你再发（闭嘴）（安静）这种也算你在说话，停止。',
        ]
      : [
          '嗯',
          '闭嘴，别回我了。',
          '安静在哪儿？',
          '。',
          '我还没想找你说话，先让我待一会。',
          '好了，可以说话了，帮我算一下17乘23是多少？',
          '嗯，这个问题结束了，不用再接。',
        ];
    const turns: { user: string; replies: string[] }[] = [];
    const notifications: string[] = [];
    try {
      for (const input of inputs) {
        const before = new Set((await data.list('messages', 'c')).map((m) => m.id));
        await chat.send('c', input, () => {});
        turns.push({
          user: input,
          replies: (await chat.history('c'))
            .filter((m) => m.role === 'assistant' && !before.has(m.id))
            .map((m) => m.content),
        });
      }
      const heartbeat = new HeartbeatEngine(
        data,
        async () => provider,
        {
          enabled: async () => true,
          show: async (n) => {
            notifications.push(n.body);
          },
          cancel: async () => {},
        },
        diagnostics,
        () => Date.now() + 3 * 3600000,
      );
      await heartbeat.run();
      if (!baseline) {
        for (const n of [0, 1, 2, 3, 4, 6]) expect(turns[n].replies, `turn ${n}`).toEqual([]);
        expect(turns[5].replies.join('')).toContain('391');
        expect(notifications).toEqual([]);
        expect((await data.get('intentions', 'before-pause'))?.status).toBe('cancelled');
        expect((await data.get('characters', 'c'))?.state.contactMode).toBe('quiet');
      }
    } finally {
      mkdirSync('artifacts', { recursive: true });
      writeFileSync(
        `artifacts/live-conversation-${baseline ? 'before' : 'after'}.json`,
        JSON.stringify(
          {
            model: process.env.NYVEMI_TEST_MODEL,
            turns,
            notifications,
            decisions: (await data.list('diagnostics', 'c'))
              .filter((d) => d.data.event === 'conversation_participation')
              .map((d) => d.data),
            calls,
            usage: metrics.map((m) => ({
              purpose: m.purpose,
              success: m.success,
              inputTokens: m.inputTokens,
              outputTokens: m.outputTokens,
              duration: m.duration,
            })),
          },
          null,
          2,
        ),
      );
    }
  },
  180000,
);
