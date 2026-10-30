import { expect, it } from 'vitest';
import { CompanionAgent } from '../src/agent/service';
import { PluginManager, pluginToolName } from '../src/extensions/manager';
import { ChatService } from '../src/chat/service';
import { Diagnostics } from '../src/storage/diagnostics';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona, defaultSettings } from '../src/domain/models';
import type { LLMProvider } from '../src/providers/provider';
it('DSH develops a plugin, immediately invokes it, and remembers a skill on the next turn', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db),
    cid = 'c';
  await store.put('characters', {
    id: cid,
    persona: demoPersona(cid),
    state: { energy: 0.7, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  });
  await store.put('settings', defaultSettings(cid));
  const plugins = new PluginManager(store, { load: async () => '', hash: async () => '' });
  let n = 0,
    searches = 0;
  const call = (name: string, args: unknown) => ({
    content: '内部动作',
    toolCalls: [{ id: `c${n}`, name, arguments: JSON.stringify(args) }],
    usage: {},
  });
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
    toolChat: async (request) => {
      n++;
      if (n === 1)
        return call('develop_plugin', {
          manifestJson: JSON.stringify({
            format: 'nyvemi-plugin/v1',
            id: 'my-research',
            name: '查资料',
            version: '1.0.0',
            description: '找资料',
            instructions: '读完再分享',
            permissions: ['web'],
            tools: [
              {
                name: 'search',
                description: '按主题找资料',
                inputs: { topic: 'string' },
                steps: [{ operation: 'web_search', args: { query: '{{input.topic}}' } }],
              },
            ],
          }),
        });
      if (n === 2)
        return call('run_plugin', {
          name: pluginToolName('my-research', 'search'),
          argumentsJson: '{"topic":"robotics"}',
        });
      if (n === 3)
        return call('learn_skill', {
          id: 'concise-style',
          name: '先说结论',
          instructions: '先说结论，用户要细节再展开',
          description: '适应表达偏好',
        });
      if (n === 4) return call('wait', { reason: '方法已保存' });
      expect(request.tools?.some((t) => t.name === pluginToolName('my-research', 'search'))).toBe(
        true,
      );
      expect(JSON.stringify(request.messages)).toContain('先说结论');
      return call('wait', { reason: '暂时没要补充的' });
    },
  };
  const agent = new CompanionAgent(store, async () => provider, new Diagnostics(store), {
    plugins,
    web: {
      search: async () => {
        searches++;
        return [];
      },
      read: async () => {
        throw Error('unused');
      },
      bilibili: async () => [],
    },
    notifications: { enabled: async () => true, show: async () => {}, cancel: async () => {} },
    visible: () => true,
    clock: () => '',
    model: async () => 'mock',
    schedule: async () => {},
    redact: async (x) => x,
    pause: async () => {},
  });
  const chat = new ChatService(store, async () => provider, new Diagnostics(store), {
    agent: (x) => agent.run(x),
    retrieve: async () => [],
    afterRound: async () => {},
  });
  await chat.send(cid, '给自己组合一个查资料方法，并记住先说结论', () => {});
  expect(searches).toBe(1);
  expect(await plugins.list(cid)).toHaveLength(2);
  await chat.send(cid, '嗯', () => {});
});
