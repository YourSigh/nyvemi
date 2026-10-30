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
  return { store, character, host, agent, chat, scheduled, delays, notifications };
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
    return tool('wait', { untilUser: false, reason: '先等对方' });
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
      ? tool('wait', { untilUser: true, reason: '对方要独处' })
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
      : tool('wait', { untilUser: false, reason: '约好稍后来' }),
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
    n === 1
      ? tool('send_message', { messages: ['来了'] })
      : tool('wait', { untilUser: false, reason: '说完' }),
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
