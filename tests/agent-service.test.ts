import { executeIntentionWork } from '../src/proactive/requested-delivery';
import { HeartbeatEngine } from '../src/proactive/heartbeat/engine';
import { expect, it } from 'vitest';
import { CompanionAgent, type AgentHost } from '../src/agent/service';
import type { AgentModelRequest, AgentModelResult } from '../src/agent/core';
import { ChatService } from '../src/chat/service';
import { SQLiteStore, migrate } from '../src/storage/store';
import { Diagnostics } from '../src/storage/diagnostics';
import { defaultAnswers, CharacterService } from '../src/characters/service';
import type { LLMProvider } from '../src/providers/provider';
import type { Intention } from '../src/domain/models';
import { TestDatabase } from './database';
const tool = (name: string, args: unknown): AgentModelResult => ({
  content: '内部文字不自动发出',
  toolCalls: [{ id: `c-${name}`, name, arguments: JSON.stringify(args) }],
  usage: {},
});
async function setup(script: (request: AgentModelRequest, n: number) => Promise<AgentModelResult>) {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  let n = 0;
  const provider: LLMProvider = {
    chat: async () => {
      throw Error('legacy');
    },
    streamChat: async () => {
      throw Error('legacy');
    },
    structuredOutput: async () => {
      throw Error('legacy');
    },
    toolChat: (request) => script(request, ++n),
  };
  const character = await new CharacterService(store, async () => provider).create(
    { ...defaultAnswers, name: '桶砸' },
    true,
    'c',
  );
  const scheduled: Intention[] = [],
    delays: number[] = [],
    notifications: string[] = [];
  const host: AgentHost = {
    web: {
      search: async () => [
        {
          url: 'https://example.com/robot',
          title: '机器人学会新动作',
          text: '真实页面测试夹具，非联网数据。',
          source: 'mock-web',
        },
      ],
      read: async () => {
        throw Error('offline');
      },
      bilibili: async () => [],
    },
    notifications: {
      enabled: async () => true,
      show: async (n) => {
        notifications.push(n.body);
      },
      cancel: async () => {},
    },
    visible: () => true,
    model: async () => 'mock',
    clock: () => '设备当前时间',
    schedule: async (task) => {
      scheduled.push(task);
    },
    redact: async (x) => x,
    pause: async (ms) => {
      delays.push(ms);
    },
  };
  const diagnostics = new Diagnostics(store),
    agent = new CompanionAgent(store, async () => provider, diagnostics, host);
  const chat = new ChatService(store, async () => provider, diagnostics, {
    agent: (input) => agent.run(input),
    retrieve: async () => [],
    afterRound: async () => {},
  });
  return { store, character, host, agent, chat, scheduled, delays, notifications, provider };
}
it('the real DSH action loop reads evidence, remembers an experience and emits separate paced bubbles', async () => {
  let evidenceId = '';
  const f = await setup(async (request, n) => {
    if (n === 1) return tool('web_search', { query: 'robotics' });
    if (n === 2) {
      evidenceId = JSON.parse(request.messages.at(-1)!.content[0].text!)[0].evidenceId;
      return tool('remember_experience', {
        evidenceId,
        impression: '这个小机器人挺有意思',
        topics: ['robotics'],
        appraisal: {
          selfInterest: 0.8,
          userRelevance: 0.4,
          novelty: 0.8,
          emotionalValue: 0.5,
          shareImpulse: 0.8,
        },
      });
    }
    if (n === 3)
      return tool('send_message', { messages: ['诶', '这个机器人学动作的办法还挺有意思'] });
    return tool('wait', { reason: '先等对方' });
  });
  await f.chat.send('c', '找个你喜欢的东西看看', () => {});
  const messages = await f.chat.history('c');
  expect(messages.map((m) => m.content)).toEqual([
    '找个你喜欢的东西看看',
    '诶',
    '这个机器人学动作的办法还挺有意思',
  ]);
  expect(f.delays).toHaveLength(2);
  expect(f.delays[1]).toBeGreaterThan(f.delays[0]);
  const experiences = await f.store.list('experiences', 'c');
  expect(experiences).toHaveLength(1);
  expect(experiences[0].appraisal?.shareImpulse).toBe(0.8);
  expect((await f.store.list('memories', 'c')).some((m) => m.type === 'experience')).toBe(true);
  expect((await f.store.get('agentSessions', 'c'))?.lastRunStatus).toBe('complete');
});
it('wait and ordinary assistant text both allow silence without a confirmation bubble', async () => {
  const f = await setup(async (_, n) =>
    n === 1
      ? tool('pause_contact', { reason: '对方要独处' })
      : { content: '（安静）', toolCalls: [], usage: {} },
  );
  await f.chat.send('c', '闭嘴，别回了', () => {});
  await f.chat.send('c', '。', () => {});
  expect((await f.chat.history('c')).filter((m) => m.role === 'assistant')).toEqual([]);
  expect((await f.store.get('characters', 'c'))?.state.contactMode).toBe('quiet');
});
it('a natural scheduled request is registered by a model-selected tool, without a regex acknowledgement', async () => {
  const f = await setup(async (_, n) =>
    n === 1
      ? tool('schedule_wakeup', { afterSeconds: 60, reason: '想起来再聊一小句', requested: true })
      : tool('wait', { reason: '约好稍后来' }),
  );
  const start = Date.now();
  await f.chat.send('c', '芜湖，一分钟后随便给我发一条消息吧', () => {});
  expect(f.scheduled).toHaveLength(1);
  expect(f.scheduled[0].agentWakeup).toBe(true);
  expect(f.scheduled[0].earliestAt - start).toBeGreaterThanOrEqual(60000);
  expect((await f.chat.history('c')).some((m) => m.id.startsWith('ack:'))).toBe(false);
});
it('keeps notification outbox recoverable if the OS fails to display it', async () => {
  const f = await setup(async (_, n) =>
    n === 1 ? tool('send_message', { messages: ['来了'] }) : tool('wait', { reason: '说完' }),
  );
  f.host.visible = () => false;
  let fails = true;
  f.host.notifications.show = async () => {
    if (fails) throw Error('OS');
  };
  await f.chat.send('c', '你好', () => {});
  expect((await f.store.list('notifications', 'c'))[0].status).toBe('pending');
  fails = false;
  await f.agent.flushOutbox('c');
  expect((await f.store.list('notifications', 'c'))[0].status).toBe('delivered');
});
it('restores a scheduled wake in a new runtime and delivers a background notification only once', async () => {
  const f = await setup(async (_, n) =>
    n === 1
      ? tool('schedule_wakeup', { afterSeconds: 60, reason: '约好再聊', requested: true })
      : n === 2
        ? tool('wait', { reason: '等会儿' })
        : n === 3
          ? tool('send_message', { messages: ['我又想起一件事', '刚才那个点还挺有趣'] })
          : tool('wait', { reason: '说完' }),
  );
  await f.chat.send('c', '一分钟后来找我', () => {});
  const task = f.scheduled[0];
  await f.store.put('intentions', { ...task, earliestAt: Date.now() - 1 });
  f.host.visible = () => false;
  const cold = new CompanionAgent(
    f.store,
    async () => f.provider,
    new Diagnostics(f.store),
    f.host,
  );
  const heartbeat = new HeartbeatEngine(
    f.store,
    async () => f.provider,
    f.host.notifications,
    new Diagnostics(f.store),
    Date.now,
    () => {},
    cold,
  );
  await heartbeat.runIntention(task.id);
  await heartbeat.runIntention(task.id);
  expect(f.notifications).toHaveLength(1);
  expect(f.notifications[0]).toContain('我又想起一件事');
  expect((await f.store.get('intentions', task.id))?.status).toBe('completed');
});
it('does no model work for frequent heartbeats and respects persistent quiet state', async () => {
  let calls = 0;
  const f = await setup(async () => {
    calls++;
    return tool('wait', { reason: '暂时没有想做的事' });
  });
  const settings = (await f.store.get('settings', 'c'))!;
  await f.store.put('settings', {
    ...settings,
    lastActiveAt: Date.now() - 86400000,
    quietStart: 0,
    quietEnd: 0,
  });
  for (let i = 0; i < 15; i++) await f.agent.heartbeat();
  expect(calls).toBe(1);
  const c = (await f.store.get('characters', 'c'))!;
  await f.store.put('characters', { ...c, state: { ...c.state, contactMode: 'quiet' } });
  const session = (await f.store.get('agentSessions', 'c'))!;
  await f.store.put('agentSessions', { ...session, nextExploreAt: 0 });
  await f.agent.heartbeat();
  expect(calls).toBe(1);
});
it('does not resurrect a canceled intention after the model returns late', async () => {
  const f = await setup(async () => {
    const task = (await f.store.list('intentions', 'c'))[0];
    await f.store.put('intentions', { ...task, status: 'cancelled' });
    return tool('send_message', { messages: ['不该发出'] });
  });
  f.host.visible = () => false;
  const task: Intention = {
    id: 't',
    characterId: 'c',
    type: 'requested',
    topic: 'test',
    reason: 'test',
    importance: 1,
    earliestAt: Date.now() - 1,
    latestAt: Date.now() + 60000,
    createdAt: Date.now(),
    status: 'pending',
  };
  await f.store.put('intentions', task);
  await f.agent.due(undefined, 't');
  expect(f.notifications).toEqual([]);
  expect((await f.store.list('messages', 'c')).filter((m) => m.role === 'assistant')).toEqual([]);
  expect((await f.store.get('intentions', 't'))?.status).toBe('cancelled');
});
it('a new user message aborts a background model request and then gets the agent', async () => {
  const f = await setup(async () => ({ content: '', toolCalls: [], usage: {} }));
  let begin!: () => void;
  const began = new Promise<void>((resolve) => {
    begin = resolve;
  });
  let requests = 0,
    aborted = false;
  f.provider.toolChat = async (_request, signal) => {
    if (++requests === 1) {
      begin();
      return new Promise((_, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(Error('aborted'));
          },
          { once: true },
        );
      });
    }
    return requests === 2
      ? tool('send_message', { messages: ['391'] })
      : tool('wait', { reason: '等对方' });
  };
  const now = Date.now();
  await f.store.put('intentions', {
    id: 'wake',
    characterId: 'c',
    type: 'requested',
    topic: 'test',
    reason: 'test',
    importance: 1,
    earliestAt: now - 1,
    latestAt: now + 60000,
    createdAt: now,
    status: 'pending',
  });
  const background = f.agent.due(undefined, 'wake');
  await began;
  await f.chat.send('c', '先算17乘23', () => {});
  await background;
  expect(aborted).toBe(true);
  expect(
    (await f.chat.history('c')).filter((m) => m.role === 'assistant').map((m) => m.content),
  ).toEqual(['391']);
});
it('can follow its own interest through browsing, appraisal, a delayed thought and a later message', async () => {
  let evidenceId = '';
  const f = await setup(async (request, n) => {
    if (n === 1) return tool('browse_bilibili', { query: '机器人' });
    if (n === 2) {
      evidenceId = JSON.parse(request.messages.at(-1)!.content[0].text!)[0].evidenceId;
      return tool('remember_experience', {
        evidenceId,
        impression: '这个机械动作让我好奇',
        topics: ['robotics'],
        appraisal: {
          selfInterest: 0.9,
          userRelevance: 0.4,
          novelty: 0.8,
          emotionalValue: 0.6,
          shareImpulse: 0.85,
        },
      });
    }
    if (n === 3)
      return tool('schedule_wakeup', {
        afterSeconds: 120,
        reason: '再想想这个机器人，找合适的时候聊',
        requested: false,
      });
    if (n === 4) return tool('wait', { reason: '现在先不打扰' });
    if (n === 5)
      return tool('send_message', { messages: ['刚才刷到的机器人，我还在琢磨它怎么学动作的'] });
    return tool('wait', { reason: '聊到这里' });
  });
  f.host.visible = () => false;
  f.host.web.bilibili = async () => [
    {
      url: 'https://www.bilibili.com/video/BV1234567890',
      title: '机器人新动作',
      text: '[Mock] 仅标题简介，未播放视频',
      source: 'mock-bilibili-metadata',
    },
  ];
  const settings = (await f.store.get('settings', 'c'))!;
  await f.store.put('settings', {
    ...settings,
    lastActiveAt: Date.now() - 86400000,
    quietStart: 0,
    quietEnd: 0,
  });
  const c = (await f.store.get('characters', 'c'))!;
  await f.store.put('characters', {
    ...c,
    interests: [
      { topic: 'robotics', score: 0.4, source: 'initial', updatedAt: Date.now() - 86400000 },
    ],
  });
  await f.agent.heartbeat();
  expect(f.notifications).toEqual([]);
  expect(f.scheduled).toHaveLength(1);
  expect((await f.store.list('experiences', 'c'))[0].appraisal?.shareImpulse).toBe(0.85);
  expect((await f.store.get('characters', 'c'))!.interests[0].score).toBeGreaterThan(0.4);
  await f.store.put('intentions', { ...f.scheduled[0], earliestAt: Date.now() - 1 });
  await f.agent.due(undefined, f.scheduled[0].id);
  expect(f.notifications).toHaveLength(1);
});

it('a completed DSH turn is not a successful native receipt while its notification is pending', async () => {
  let calls = 0;
  const f = await setup(async () =>
    ++calls === 1
      ? tool('send_message', { messages: ['约好的来信'] })
      : tool('wait', { reason: '等对方' }),
  );
  f.host.visible = () => false;
  let fail = true;
  f.host.notifications.show = async () => {
    if (fail) throw Error('OS');
  };
  const now = Date.now();
  await f.store.put('intentions', {
    id: 'receipt',
    characterId: 'c',
    type: 'requested',
    agentWakeup: true,
    topic: 'test',
    reason: 'test',
    importance: 1,
    earliestAt: now - 1,
    latestAt: now + 60000,
    createdAt: now,
    status: 'pending',
  });
  const run = (id: string) => f.agent.due(undefined, id);
  expect(await executeIntentionWork(f.store, run, 'receipt')).toBe(false);
  const previous = calls;
  fail = false;
  expect(await executeIntentionWork(f.store, run, 'receipt')).toBe(true);
  expect(calls).toBe(previous);
});
it('a promised delivery that only waits remains retryable rather than being marked delivered', async () => {
  const f = await setup(async () => tool('wait', { reason: '现在没有话' }));
  const now = Date.now();
  await f.store.put('intentions', {
    id: 'promise',
    characterId: 'c',
    type: 'requested',
    agentWakeup: true,
    topic: 'test',
    reason: 'test',
    importance: 1,
    earliestAt: now - 1,
    latestAt: now + 60000,
    createdAt: now,
    status: 'pending',
  });
  await f.agent.due(undefined, 'promise');
  expect((await f.store.get('intentions', 'promise'))?.status).toBe('pending');
  expect((await f.store.get('intentions', 'promise'))?.attempts).toBe(1);
});
