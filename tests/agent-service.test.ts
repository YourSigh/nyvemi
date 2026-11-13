import { executeIntentionWork } from '../src/proactive/requested-delivery';
import { HeartbeatEngine } from '../src/proactive/heartbeat/engine';
import { expect, it, vi } from 'vitest';
import { CompanionAgent, type AgentHost } from '../src/agent/service';
import type { AgentModelRequest, AgentModelResult } from '../src/agent/core';
import { ChatService } from '../src/chat/service';
import { SQLiteStore, migrate } from '../src/storage/store';
import { serializeDatabase } from '../src/storage/serialized';
import { Diagnostics } from '../src/storage/diagnostics';
import { MemoryExtractionService } from '../src/memory/extraction';
import { dialoguePreferences } from '../src/memory/dialogue-preference';
import { MemoryRecall } from '../src/memory/recall';
import { defaultAnswers, CharacterService } from '../src/characters/service';
import type { LLMProvider } from '../src/providers/provider';
import type { Intention, Message } from '../src/domain/models';
import { TestDatabase } from './database';
const tool = (name: string, args: unknown): AgentModelResult => ({
  content: '内部文字不自动发出',
  toolCalls: [{ id: `c-${name}`, name, arguments: JSON.stringify(args) }],
  usage: {},
});
async function setup(script: (request: AgentModelRequest, n: number) => Promise<AgentModelResult>) {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(serializeDatabase(db));
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
    { ...defaultAnswers, name: '小舟' },
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

async function priorAssistant(store: SQLiteStore, content: string, age = 1000) {
  const prior: Message = {
    id: 'earlier-chat',
    characterId: 'c',
    role: 'assistant',
    content,
    createdAt: Date.now() - age,
    origin: 'chat',
    status: 'complete',
  };
  await store.put('messages', prior);
}

it('blocks every proposed bubble and does not reopen the model loop after confirmed closure', async () => {
  const generate = vi.fn(
    async (): Promise<AgentModelResult> => ({
      content: '',
      toolCalls: [
        {
          id: 'send-first',
          name: 'send_message',
          arguments: JSON.stringify({ messages: ['回头把计时器给我看看', '我还好奇那块'] }),
        },
        {
          id: 'send-second',
          name: 'send_message',
          arguments: JSON.stringify({ messages: ['明天再和我说一下吧'] }),
        },
      ],
      usage: {},
    }),
  );
  const f = await setup(generate);
  await priorAssistant(f.store, '所以你那个计时器是自己做的？');
  const semantic = vi.fn(async () => ({ action: 'closed' as const }));
  f.provider.structuredOutput = semantic as LLMProvider['structuredOutput'];
  const prepare = vi.fn();
  await f.chat.send(
    'c',
    '嗯，那今天先聊到这儿。',
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    prepare,
  );

  const transcript = await f.chat.history('c');
  expect(transcript.filter((m) => m.role === 'assistant').map((m) => m.content)).toEqual([
    '所以你那个计时器是自己做的？',
  ]);
  expect(transcript.at(-1)?.replyDisposition).toBe('silence');
  expect((await f.store.get('characters', 'c'))?.state.contactMode).not.toBe('quiet');
  expect(await f.store.list('notifications', 'c')).toEqual([]);
  expect(prepare).not.toHaveBeenCalled();
  expect(generate).toHaveBeenCalledTimes(1);
  expect(semantic).toHaveBeenCalledTimes(1);
  expect(semantic).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('所以你那个计时器是自己做的？'),
      }),
    ]),
    expect.anything(),
    'conversation_delivery_review',
    expect.anything(),
  );
});

it('allows a substantive new question at the end of a topic and reviews later bubbles only once', async () => {
  const f = await setup(async (_, n) => {
    if (n === 1) return tool('send_message', { messages: ['十七乘二十三等于 391'] });
    if (n === 2)
      return {
        ...tool('send_message', { messages: ['拆成二十和三来算就行'] }),
        toolCalls: [
          {
            id: 'explain',
            name: 'send_message',
            arguments: '{"messages":["拆成二十和三来算就行"]}',
          },
        ],
      };
    return tool('wait', { reason: '答完了' });
  });
  await priorAssistant(f.store, '计时器的事聊完啦。');
  const semantic = vi.fn(async () => ({ action: 'allow' as const }));
  f.provider.structuredOutput = semantic as LLMProvider['structuredOutput'];
  await f.chat.send('c', '这事先放放，另外 17 乘 23 等于多少？', () => {});

  expect(semantic).toHaveBeenCalledTimes(1);
  expect((await f.chat.history('c')).filter((m) => m.role === 'assistant')).toHaveLength(3);
});

it('can review a model-marked long closure and allows sending if review fails', async () => {
  const f = await setup(async (_, n) =>
    n === 1
      ? tool('send_message', { messages: ['好，歇会吧'], deliveryContext: 'closure' })
      : tool('wait', { reason: '等下一轮' }),
  );
  const semantic = vi.fn(async () => {
    throw new Error('review temporarily unavailable');
  });
  f.provider.structuredOutput = semantic;
  await f.chat.send(
    'c',
    '我把前面说的那些事先整理一下，剩下的部分还得看看明天是什么情况。' +
      '今天没法继续聊这件事了，我接下来会关掉手机去忙，其他的之后再说。'.repeat(2),
    () => {},
  );
  expect(semantic).toHaveBeenCalledTimes(1);
  expect((await f.chat.history('c')).at(-1)?.content).toBe('好，歇会吧');
  expect(
    (await f.store.list('diagnostics', 'c')).some(
      (d) => d.data.event === 'conversation_delivery' && d.data.action === 'unavailable',
    ),
  ).toBe(true);
});
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
  const draftsAlreadyVisible: boolean[] = [];
  const prepareSpeech = vi.fn(async (id: string) => {
    draftsAlreadyVisible.push(Boolean(await f.store.get('messages', id)));
    return true;
  });
  await f.chat.send(
    'c',
    '找个你喜欢的东西看看',
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    prepareSpeech,
  );
  const messages = await f.chat.history('c');
  expect(messages.map((m) => m.content)).toEqual([
    '找个你喜欢的东西看看',
    '诶',
    '这个机器人学动作的办法还挺有意思',
  ]);
  expect(draftsAlreadyVisible).toEqual([false, false]);
  expect(prepareSpeech.mock.calls.map(([id]) => id)).toEqual(
    messages.filter((m) => m.role === 'assistant').map((m) => m.id),
  );
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
it('learns explicit conversation preferences across restarts and removes a retracted preference', async () => {
  const original = '以后我光吐槽的时候，先跟我一起吐槽，别给建议';
  const revised = '改一下，我吐槽时先听着，需要时再给一个建议';
  const removal = '那条我吐槽时怎么回的偏好不用记了';
  const key = 'venting-replies';
  let characterPrompt = '';
  const f = await setup(async (request) => {
    characterPrompt = request.messages[0].content.map((block) => block.text).join('\n');
    const latest = request.messages.at(-1)!;
    if (latest.role !== 'user') return tool('wait', { reason: '没有要补的话' });
    const event = JSON.parse(latest.content[0].text!);
    if (event.text === original || event.text === revised)
      return tool('remember_conversation_preference', {
        action: 'set',
        key,
        quote: event.text,
        preference:
          event.text === original ? '吐槽时接梗，省掉建议' : '吐槽时先听，必要时只提一个建议',
      });
    if (event.text === removal)
      return tool('remember_conversation_preference', { action: 'forget', key, quote: event.text });
    return tool('wait', { reason: '对话自然停住' });
  });
  await f.chat.send('c', original, () => {});
  const feedbackTurn = (await f.chat.history('c'))[0];
  expect(feedbackTurn.replyDisposition).toBe('silence');
  expect(await dialoguePreferences(f.store, 'c')).toEqual([
    { key, preference: '吐槽时接梗，省掉建议' },
  ]);
  const diagnostics = new Diagnostics(f.store);
  const extraction = new MemoryExtractionService(f.store, async () => f.provider, diagnostics);
  await extraction.apply(
    'c',
    {
      memories: [],
      openLoops: [],
      relationshipUpdates: [],
      personaFeedback: ['不要给建议'],
      completedOpenLoopIds: [],
    },
    Date.now(),
    feedbackTurn.id,
  );
  expect((await f.store.get('characters', 'c'))?.persona.responsePreferences).not.toContain(
    '不要给建议',
  );

  const restarted = new CompanionAgent(f.store, async () => f.provider, diagnostics, f.host);
  const chat = new ChatService(f.store, async () => f.provider, diagnostics, {
    agent: (input) => restarted.run(input),
    retrieve: async () => [],
    afterRound: async () => {},
  });
  await chat.send('c', '周末去哪里好', () => {});
  expect(characterPrompt).toContain(`"key":"${key}","preference":"吐槽时接梗，省掉建议"`);
  expect(characterPrompt).toContain('短消息也可能正好答了刚才的问题');
  await chat.send('c', revised, () => {});
  expect(await dialoguePreferences(f.store, 'c')).toEqual([
    { key, preference: '吐槽时先听，必要时只提一个建议' },
  ]);
  expect(
    await new MemoryRecall(f.store, diagnostics).retrieve('c', '吐槽时接梗，省掉建议'),
  ).toEqual([]);
  await chat.send('c', removal, () => {});
  await chat.send('c', '天快黑了', () => {});
  expect(characterPrompt).toContain(
    '当前有效的聊天偏好（用户直接提出；同一习惯以较新的要求为准）：[]',
  );
  expect(await dialoguePreferences(f.store, 'c')).toEqual([]);
  expect((await chat.history('c')).every((message) => message.role === 'user')).toBe(true);
});

it('rejects unsourced preference writes and never exposes the action to autonomous turns', async () => {
  let autonomousToolPresent: boolean | undefined;
  const f = await setup(async (request, n) => {
    if (n === 1)
      return tool('remember_conversation_preference', {
        action: 'set',
        key: 'unfounded',
        quote: '这条原话不在消息里',
        preference: '每天换一个称呼',
      });
    if (n === 3)
      autonomousToolPresent = request.tools?.some(
        (item) => item.name === 'remember_conversation_preference',
      );
    return tool('wait', { reason: '没有要补的话' });
  });
  await f.chat.send('c', '刚才那件事我还在想', () => {});
  expect(await dialoguePreferences(f.store, 'c')).toEqual([]);
  const due = Date.now() - 1000;
  const task: Intention = {
    id: 'autonomous-preference-check',
    characterId: 'c',
    type: 'requested',
    topic: '测试',
    reason: '测试',
    earliestAt: due,
    latestAt: due + 60_000,
    importance: 0.7,
    status: 'pending',
    createdAt: due,
  };
  await f.store.put('intentions', task);
  await expect(f.agent.run({ characterId: 'c', task })).rejects.toThrow();
  expect(autonomousToolPresent).toBe(false);
  expect(await dialoguePreferences(f.store, 'c')).toEqual([]);
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
it('allows only one concurrent worker to post the same pending notification', async () => {
  const f = await setup(async () => tool('wait', { reason: '测试' }));
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const finishing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const show = vi.fn(async () => {
    enter();
    await finishing;
  });
  f.host.notifications.show = show;
  await f.store.put('notifications', {
    id: 'agent:queued-share',
    characterId: 'c',
    messageId: 'queued-message',
    title: '小舟',
    body: '看看这个',
    deliveryKind: 'initiative',
    createdAt: Date.now(),
    status: 'pending',
  });
  const competing = new CompanionAgent(
    f.store,
    async () => f.provider,
    new Diagnostics(f.store),
    f.host,
  );
  const first = f.agent.flushOutbox('c');
  await entered;
  await competing.flushOutbox('c');
  release();
  await first;
  expect(show).toHaveBeenCalledTimes(1);
  expect((await f.store.get('notifications', 'agent:queued-share'))?.status).toBe('delivered');
});

it('keeps a completed share terminal even if another lane read an older pending snapshot', async () => {
  const model = vi.fn(async () => tool('wait', { reason: '测试' }));
  const f = await setup(model);
  const now = Date.now();
  const task: Intention = {
    id: 'concurrent-share',
    characterId: 'c',
    type: 'share',
    topic: '机器人',
    reason: '觉得挺有意思',
    importance: 0.9,
    earliestAt: now - 1000,
    latestAt: now + 3600000,
    status: 'pending',
    createdAt: now,
  };
  await f.store.put('intentions', task);
  const list = f.store.list.bind(f.store);
  vi.spyOn(f.store, 'list').mockImplementation(async (kind, characterId, limit) => {
    const rows = await list(kind, characterId, limit);
    if (kind === 'messages' && limit === 100)
      await f.store.put('intentions', { ...task, status: 'completed' });
    return rows;
  });
  await f.agent.due('share');
  expect(await f.store.get('intentions', task.id)).toMatchObject({ status: 'completed' });
  expect(model).not.toHaveBeenCalled();
});

it('does not count contention on the shared agent lease as a generation failure', async () => {
  const model = vi.fn(async () => tool('wait', { reason: '测试' }));
  const f = await setup(model);
  const now = Date.now();
  await f.store.put('settings', {
    ...(await f.store.get('settings', 'c'))!,
    quietStart: 0,
    quietEnd: 0,
    lastActiveAt: now - 86400000,
  });
  const task: Intention = {
    id: 'lease-share',
    characterId: 'c',
    type: 'share',
    topic: '机器人',
    reason: '觉得挺有意思',
    importance: 0.9,
    earliestAt: now - 1000,
    latestAt: now + 3600000,
    status: 'pending',
    createdAt: now,
  };
  await f.store.put('intentions', task);
  expect(await f.store.lease('agent-runtime', now, 60_000)).toBe(true);
  await f.agent.due('share');
  expect(await f.store.get('intentions', task.id)).toEqual(task);
  expect(model).not.toHaveBeenCalled();
  expect(await f.store.list('diagnostics', 'c')).toContainEqual(
    expect.objectContaining({ data: expect.objectContaining({ reason: 'agent_busy' }) }),
  );
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

it.each([
  { count: 1, reason: 'global_minimum_interval' },
  { count: 4, reason: 'global_daily_limit' },
])('checks $reason across characters before running a share', async ({ count, reason }) => {
  const model = vi.fn(async () => tool('send_message', { messages: ['有件事想分享'] }));
  const f = await setup(model);
  f.host.visible = () => false;
  const now = Date.now();
  await f.store.put('settings', {
    ...(await f.store.get('settings', 'c'))!,
    quietStart: 0,
    quietEnd: 0,
    lastActiveAt: now - 86400000,
  });
  for (let n = 0; n < count; n++) {
    await f.store.put('notifications', {
      id: `other:${n}`,
      characterId: `other-character:${n}`,
      messageId: `other-message:${n}`,
      title: '另一个角色',
      body: '先前主动来信',
      deliveryKind: 'initiative',
      createdAt: now,
      deliveredAt: now,
      status: 'delivered',
    });
  }
  const task: Intention = {
    id: 'share',
    characterId: 'c',
    type: 'share',
    topic: '机器人',
    reason: '想分享新鲜事',
    importance: 0.9,
    earliestAt: now - 1,
    latestAt: now + 3600000,
    createdAt: now,
    status: 'pending',
  };
  await f.store.put('intentions', task);
  const run = (id: string) => f.agent.due(undefined, id);
  expect(await executeIntentionWork(f.store, run, task.id)).toBe(false);
  expect(model).not.toHaveBeenCalled();
  expect(await f.store.get('intentions', task.id)).toMatchObject({
    status: 'pending',
    earliestAt: expect.any(Number),
  });
  expect((await f.store.get('intentions', task.id))!.earliestAt).toBeGreaterThan(now);
  expect(await f.store.list('diagnostics', 'c')).toContainEqual(
    expect.objectContaining({ data: expect.objectContaining({ reason }) }),
  );
});

it.each(['share', 'follow_up', 'continuation', 'reconnect', 'requested'] as const)(
  'bounds failed generation for unsolicited %s while retaining requested recovery',
  async (type) => {
    const model = vi.fn(async () => {
      throw Error('模型请求失败（HTTP 503）');
    });
    const f = await setup(model);
    f.host.visible = () => false;
    const now = Date.now();
    await f.store.put('settings', {
      ...(await f.store.get('settings', 'c'))!,
      quietStart: 0,
      quietEnd: 0,
      lastActiveAt: now - 86400000,
    });
    await f.store.put('messages', {
      id: 'prior-user',
      characterId: 'c',
      role: 'user',
      content: '我下午去听机器人讲座',
      createdAt: now - 15 * 60000,
      origin: 'chat',
      status: 'complete',
    });
    const task: Intention = {
      id: 'retry',
      characterId: 'c',
      type,
      sourceMessageId: 'prior-user',
      topic: '机器人',
      reason: '上次聊到这里',
      importance: 0.9,
      earliestAt: now - 1,
      latestAt: now + 3600000,
      createdAt: now,
      status: 'pending',
    };
    await f.store.put('intentions', task);
    for (let n = 1; n <= 4; n++) {
      const cold = new CompanionAgent(
        f.store,
        async () => f.provider,
        new Diagnostics(f.store),
        f.host,
      );
      const run = (id: string) => cold.due(undefined, id);
      const exhausted = type !== 'requested' && n >= 3;
      expect(await executeIntentionWork(f.store, run, task.id)).toBe(exhausted);
      const saved = (await f.store.get('intentions', task.id))!;
      expect(saved.attempts).toBe(type === 'requested' ? n : Math.min(n, 3));
      expect(saved.status).toBe(exhausted ? 'cancelled' : 'pending');
      if (saved.status === 'pending') {
        expect(saved.earliestAt).toBeGreaterThan(now);
        await f.store.put('intentions', { ...saved, earliestAt: now - 1 });
      }
    }
    expect(model).toHaveBeenCalledTimes(type === 'requested' ? 4 : 3);
    expect(f.notifications).toHaveLength(0);
    if (type !== 'requested')
      expect(await f.store.list('diagnostics', 'c')).toContainEqual(
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'agent_retry_exhausted' }),
        }),
      );
  },
);

it('reports the actual provider failure, keeps private details redacted and retries the same user message', async () => {
  let fail = true;
  const f = await setup(async (_request, n) => {
    if (fail) throw Error('模型请求失败（HTTP 401） test-secret');
    if (n === 2) return tool('send_message', { messages: ['现在连上了'] });
    return tool('wait', { reason: '等对方' });
  });
  const { redactKnownSecret } = await import('../src/domain/privacy');
  f.host.redact = async (value) => redactKnownSecret(value, 'test-secret');
  await expect(f.chat.send('c', '你好', () => {})).rejects.toThrow(
    '请在聊天模型设置里检查密钥和权限',
  );
  const user = (await f.chat.history('c')).find((m) => m.role === 'user')!;
  expect(user.status).toBe('error');
  const errors = await f.store.list('diagnostics', 'c');
  expect(errors.some((row) => row.data.code === 'provider_auth')).toBe(true);
  expect(JSON.stringify(errors)).not.toContain('test-secret');
  fail = false;
  await f.chat.send(
    'c',
    user.content,
    () => {},
    () => {},
    undefined,
    user.id,
  );
  const history = await f.chat.history('c');
  expect(history.filter((m) => m.role === 'user')).toHaveLength(1);
  expect(history.find((m) => m.id === user.id)?.status).toBe('complete');
  expect(history.some((m) => m.content === '现在连上了')).toBe(true);
});

it('allows the model to offer voice settings for natural requests without starting a download', async () => {
  const f = await setup(async (request, n) => {
    if (n === 1) {
      expect(request.tools?.some(({ name }) => name === 'offer_voice_settings')).toBe(true);
      return tool('offer_voice_settings', { caption: '试试我别的说话声？' });
    }
    return tool('wait', { reason: '等对方挑音色' });
  });
  await f.chat.send('c', '听腻你这个调调了，有其他选择嘛？', () => {});
  const history = await f.chat.history('c');
  expect(history.filter((m) => m.voiceSettings)).toEqual([
    expect.objectContaining({
      role: 'assistant',
      groupId: history[0].id,
      content: '试试我别的说话声？',
    }),
  ]);
});
