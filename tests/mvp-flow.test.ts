import { createServer } from 'node:http';
import { once } from 'node:events';
import { it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset } from '../src/providers/provider';
import { CharacterService, defaultAnswers } from '../src/characters/service';
import { ChatService } from '../src/chat/service';
import { MemoryRepository } from '../src/memory/repository';
import { KeywordMemoryRetriever } from '../src/memory/retrieval';
import { MemoryExtractionService } from '../src/memory/extraction';
import { HeartbeatEngine } from '../src/proactive/heartbeat/engine';
import { ExperienceEngine } from '../src/experience/engine';
import { parseRss } from '../src/experience/sources';
import { CharacterBundleService } from '../src/transfer/bundle';
import { demoPersona, type NotificationRecord } from '../src/domain/models';
import { Diagnostics } from '../src/storage/diagnostics';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';

it('runs persona → streamed chat → extracted memory/loop → follow-up → RSS share → clean-device migration over HTTP fixtures', async () => {
  // This is an explicitly deterministic protocol fixture, not a claim about real-model output quality.
  const requests: { stream: boolean; prompt: string }[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as { stream: boolean; messages: { content: string }[] };
    const prompt = body.messages.map((m) => m.content).join('\n');
    requests.push({ stream: body.stream, prompt });
    let content = '';
    if (prompt.includes('根据自然问答创造'))
      content = JSON.stringify({ ...demoPersona('remote-id'), likes: ['Android 自动化'] });
    else if (prompt.includes('提取有长期价值'))
      content = JSON.stringify({
        memories: [
          {
            type: 'semantic',
            content: '用户在研究 Android 自动化 Agent 根据手机操作学习脚本',
            importance: 0.9,
            expiresInDays: null,
          },
        ],
        relationshipUpdates: [
          { content: '用户讨厌每句最后问要不要继续', importance: 0.95, expiresInDays: null },
        ],
        openLoops: [
          {
            topic: '下午的 AI代码治理会议',
            importance: 0.95,
            reason: '值得之后问结果',
            earliestInMinutes: 15,
            latestInMinutes: 180,
          },
        ],
        personaFeedback: ['不要在每句话结尾问要不要继续'],
        completedOpenLoopIds: [],
      });
    else if (prompt.includes('这次是你主动找用户'))
      content = JSON.stringify({
        messages: [
          prompt.includes('rss:https://example.org/feed')
            ? '草我刚看到个东西，这不就是你之前说的手机操作学脚本么'
            : '你下午那破会最后聊出啥了',
        ],
      });
    else content = JSON.stringify({ messages: ['又是会啊', '先别管那帮人'] });
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const part of [content.slice(0, 14), content.slice(14)])
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 40, completion_tokens: 25 },
        }),
      );
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  try {
    const db = new TestDatabase();
    await migrate(db);
    const store = new SQLiteStore(db);
    const diagnostics = new Diagnostics(store);
    const metrics: unknown[] = [];
    const provider = new OpenAICompatibleProvider(
      { ...deepSeekPreset, baseUrl: `http://127.0.0.1:${address.port}/v1` },
      { get: async () => 'fixture-api-key', set: async () => {}, remove: async () => {} },
      async (m) => {
        metrics.push(m);
      },
    );
    const c = await new CharacterService(store, async () => provider).create({
      ...defaultAnswers,
      name: '桶砸',
    });
    const repo = new MemoryRepository(store);
    const extraction = new MemoryExtractionService(store, async () => provider, diagnostics);
    const chat = new ChatService(
      store,
      async () => provider,
      diagnostics,
      {
        retrieve: async (cid, query) =>
          new KeywordMemoryRetriever()
            .rank(query, await repo.list(cid), Date.now())
            .map((r) => r.memory),
        afterRound: (cid, u, a) => extraction.enqueue(cid, u, a),
      },
      async () => {},
    );
    await chat.send(
      c.id,
      '下午要开个烦人的 AI代码治理会议。我最烦 AI 每句话最后问要不要继续。',
      () => {},
    );
    const start = Date.now();
    await extraction.drain(start);
    expect(
      (await repo.list(c.id, start)).some(
        (m) => m.type === 'relationship' && m.content.includes('要不要继续'),
      ),
    ).toBe(true);
    expect(
      (await store.list('intentions', c.id)).filter((i) => i.type === 'follow_up'),
    ).toHaveLength(1);
    expect((await store.list('intentions', c.id)).some((i) => i.type === 'reconnect')).toBe(true);
    let clock = start + 150 * 60000;
    const settings = (await store.get('settings', c.id))!;
    await store.put('settings', {
      ...settings,
      proactiveEnabled: true,
      quietStart: 0,
      quietEnd: 0,
      lastActiveAt: start - 6 * 3600000,
    });
    const delivered: NotificationRecord[] = [];
    const heartbeat = new HeartbeatEngine(
      store,
      async () => provider,
      {
        enabled: async () => true,
        show: async (n) => {
          delivered.push(n);
        },
        cancel: async () => {},
      },
      diagnostics,
      () => clock,
    );
    await heartbeat.run();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].body).toContain('破会');
    await heartbeat.openNotification(delivered[0].id);
    expect(
      (await chat.history(c.id)).some((m) => m.origin === 'proactive' && m.status === 'complete'),
    ).toBe(true);
    clock += 4 * 3600000;
    const xml =
      '<rss><channel><item><guid>new-agent</guid><title>Android 自动化 Agent 根据手机操作学习脚本</title><description>用户在研究 Android 自动化 Agent 根据手机操作学习脚本</description><link>https://example.org/article</link></item></channel></rss>';
    const source = {
      id: 'rss:https://example.org/feed',
      fetch: async () => parseRss(xml, c.id, 'rss:https://example.org/feed', clock),
    };
    await new ExperienceEngine(store).ingest(
      (await store.get('characters', c.id))!,
      [source],
      clock,
    );
    expect((await store.list('experiences', c.id))[0].appraisal!.shareImpulse).toBeGreaterThan(0.7);
    clock += 3 * 3600000;
    await heartbeat.run();
    expect(delivered).toHaveLength(2);
    expect(delivered[1].body).toContain('刚看到个东西');
    await heartbeat.openChat(c.id);
    const before = requests.length;
    await heartbeat.run();
    expect(requests.length).toBe(before);
    const io = {
      readAvatar: async () => new Uint8Array(),
      writeAvatar: async () => 'file://fixture',
      removeAvatar: async () => {},
    };
    const bytes = await new CharacterBundleService(store, io).exportCharacter(
      c.id,
      'fixture-api-key',
    );
    const freshDb = new TestDatabase();
    await migrate(freshDb);
    const fresh = new SQLiteStore(freshDb);
    const restored = await new CharacterBundleService(fresh, io).importCharacter(bytes);
    expect(restored.persona.responsePreferences).toContain('不要在每句话结尾问要不要继续');
    expect(await fresh.list('messages', restored.id)).toHaveLength(5);
    expect(await fresh.list('experiences', restored.id)).toHaveLength(1);
    expect(await fresh.list('provider')).toEqual([]);
    expect(JSON.stringify(await fresh.list('memories', restored.id))).not.toContain(
      'fixture-api-key',
    );
    expect(metrics.length).toBe(5);
    expect(requests[1].stream).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
