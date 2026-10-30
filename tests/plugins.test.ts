import { expect, it } from 'vitest';
import { PluginManager, pluginToolName, type PluginLoader } from '../src/extensions/manager';
import { PluginManifestSchema, defaultPluginPolicy } from '../src/extensions/model';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona } from '../src/domain/models';
const manifest = {
  format: 'nyvemi-plugin/v1',
  id: 'reading-notes',
  name: '读书',
  version: '1.0.0',
  description: '搜索阅读资料',
  instructions: '确实读过后再说',
  permissions: ['web'],
  tools: [
    {
      name: 'find',
      description: '找资料',
      inputs: { topic: 'string' },
      steps: [{ operation: 'web_search', args: { query: '{{input.topic}}' } }],
    },
  ],
};
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 0.7, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  });
  let loads = 0;
  const loader: PluginLoader = {
    load: async () => {
      loads++;
      return JSON.stringify(manifest);
    },
    hash: async () => '0123456789abcdef0123456789abcdef',
  };
  return { store, loader, manager: new PluginManager(store, loader), loads: () => loads };
}
it('installs from a source, survives a new manager and executes declared workflows', async () => {
  const f = await setup();
  await f.manager.installUrl('c', 'https://example.com/plugin.json', 'agent');
  const cold = new PluginManager(f.store, f.loader);
  const tools = await cold.declarations('c');
  expect(tools[0].name).toBe(pluginToolName('reading-notes', 'find'));
  let query = '';
  const result = await cold.execute(
    'c',
    tools[0].name,
    { topic: 'robotics' },
    async (_name, args) => {
      query = (args as { query: string }).query;
      return ['source'];
    },
  );
  expect(query).toBe('robotics');
  expect(result).toEqual([['source']]);
});
it('holds additional image permissions, supports explicit approval and disabling', async () => {
  const f = await setup();
  const row = await f.manager.install('c', {
    ...manifest,
    permissions: ['images'],
    tools: [
      { ...manifest.tools[0], steps: [{ operation: 'draw_image', args: { prompt: 'test' } }] },
    ],
  });
  expect(row.enabled).toBe(false);
  await expect(f.manager.setEnabled('c', row.id, true)).rejects.toThrow();
  await f.manager.setEnabled('c', row.id, true, true);
  expect((await f.manager.list('c'))[0].enabled).toBe(true);
  await f.manager.setEnabled('c', row.id, false);
  await expect(
    f.manager.execute('c', pluginToolName('reading-notes', 'find'), { topic: 'x' }, async () => {}),
  ).rejects.toThrow();
});
it('versions learned skills, rolls back and respects the autonomy switch', async () => {
  const f = await setup();
  await f.manager.learn('c', { id: 'writing', name: '写作', instructions: '先给结论' });
  await f.manager.learn('c', { id: 'writing', name: '写作', instructions: '先给结论，再给来源' });
  expect((await f.manager.list('c'))[0].manifest.version).toBe('1.0.1');
  await f.manager.rollback('c', 'c:writing');
  expect(await f.manager.prompt('c')).not.toContain('再给来源');
  await f.store.put('pluginPolicies', { ...defaultPluginPolicy('c'), autonomy: false });
  await expect(
    f.manager.learn('c', { id: 'writing', name: '写作', instructions: '新方法' }),
  ).rejects.toThrow('关闭');
});
it('stops remaining steps when disabled while an earlier step is running', async () => {
  const f = await setup();
  const row = await f.manager.install('c', {
    ...manifest,
    tools: [
      { ...manifest.tools[0], steps: [...manifest.tools[0].steps, ...manifest.tools[0].steps] },
    ],
  });
  let calls = 0;
  await expect(
    f.manager.execute('c', pluginToolName('reading-notes', 'find'), { topic: 'x' }, async () => {
      calls++;
      await f.manager.setEnabled('c', row.id, false);
      return [];
    }),
  ).rejects.toThrow('停用');
  expect(calls).toBe(1);
});
it('rejects code execution, missing permissions and unbounded workflows', () => {
  expect(() =>
    PluginManifestSchema.parse({
      ...manifest,
      tools: [
        { ...manifest.tools[0], steps: [{ operation: 'shell', args: { command: 'anything' } }] },
      ],
    }),
  ).toThrow();
  expect(() => PluginManifestSchema.parse({ ...manifest, permissions: [] })).toThrow();
  expect(() =>
    PluginManifestSchema.parse({
      ...manifest,
      tools: [{ ...manifest.tools[0], steps: Array(5).fill(manifest.tools[0].steps[0]) }],
    }),
  ).toThrow();
  expect(pluginToolName('ab_cd', 'ef')).not.toBe(pluginToolName('ab', 'cd_ef'));
});
it('keeps user-disabled plugins disabled on update and binds safe result paths as real JSON values', async () => {
  const f = await setup();
  const row = await f.manager.install('c', {
    ...manifest,
    tools: [
      {
        ...manifest.tools[0],
        steps: [
          { operation: 'web_search', args: { query: '{{input.topic}}' } },
          { operation: 'web_fetch', args: { url: '{{step.0.0.url}}' } },
        ],
      },
    ],
  });
  let calls = 0;
  await f.manager.execute(
    'c',
    pluginToolName('reading-notes', 'find'),
    { topic: 'robotics' },
    async (name, args) => {
      calls++;
      if (name === 'web_search') return [{ url: 'https://example.com/a' }];
      expect(args).toEqual({ url: 'https://example.com/a' });
      return 'page';
    },
  );
  expect(calls).toBe(2);
  await f.manager.setEnabled('c', row.id, false);
  const updated = await f.manager.install(
    'c',
    { ...manifest, version: '1.0.1' },
    'developed',
    'agent',
  );
  expect(updated.enabled).toBe(false);
});
it('imports local Markdown skills and normalizes GitHub blob links to source files', async () => {
  const f = await setup();
  let url = '';
  f.loader.load = async (source) => {
    url = source;
    return '# Reading\n只根据读到的来源回答';
  };
  await f.manager.installUrl('c', 'https://github.com/owner/repo/blob/main/SKILL.md');
  expect(url).toBe('https://raw.githubusercontent.com/owner/repo/main/SKILL.md');
  await f.manager.installText('c', '# Local\n先看清问题', 'local.md');
  expect((await f.manager.list('c')).some((p) => p.manifest.name === 'Local')).toBe(true);
});
