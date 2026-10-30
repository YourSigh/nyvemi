import { expect, it } from 'vitest';
import { MediaService, type MediaPorts } from '../src/media/service';
import { defaultMediaSettings, type MediaAsset } from '../src/media/model';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona, defaultSettings } from '../src/domain/models';
import { CompanionAgent } from '../src/agent/service';
import { Diagnostics } from '../src/storage/diagnostics';
import { ChatService } from '../src/chat/service';
import type { ApiMetric, LLMProvider } from '../src/providers/provider';
const image: MediaAsset = {
  id: 'pic',
  characterId: 'c',
  createdAt: 1,
  uri: 'file://private/pic',
  fingerprint: 'f-pic',
  mime: 'image/png',
  width: 100,
  height: 80,
  origin: 'upload',
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
  await store.put('settings', defaultSettings('c'));
  await store.put('mediaAssets', image);
  const metrics: ApiMetric[] = [];
  let calls = 0,
    draws = 0;
  const ports: MediaPorts = {
    files: {
      dataUrl: async () => 'data:image/png;base64,TEST_IMAGE_BYTES',
      remove: async () => {},
    },
    hash: async (text) => text,
    secret: async () => 'vision-test-secret',
    metric: async (m) => {
      metrics.push(m);
    },
    generate: async () => {
      draws++;
      const asset = { ...image, id: 'generated', origin: 'generated' as const };
      await store.put('mediaAssets', asset);
      return asset;
    },
    request: (async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      expect(body.messages[1].content[1].image_url.url).toContain('data:image/png');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '图里是一只粉色的猫。' } }],
          usage: { prompt_tokens: 42, completion_tokens: 9 },
        }),
      );
    }) as typeof fetch,
  };
  return {
    store,
    ports,
    media: new MediaService(store, ports),
    metrics,
    calls: () => calls,
    draws: () => draws,
  };
}
it('uses a visual provider with image bytes, caches observations, meters tokens and rejects foreign image IDs', async () => {
  const f = await setup();
  expect(await f.media.inspect('c', 'pic', '画面是什么')).toContain('粉色');
  await f.media.inspect('c', 'pic', '画面是什么');
  expect(f.calls()).toBe(1);
  expect(f.metrics[0].inputTokens).toBe(42);
  expect(JSON.stringify(await f.store.list('imageAnalyses', 'c'))).not.toContain('data:image');
  expect(JSON.stringify(f.metrics)).not.toContain('vision-test-secret');
  await expect(f.media.inspect('other', 'pic', 'what')).rejects.toThrow();
});
it('does not guess images without credentials and requires separate background drawing permission', async () => {
  const f = await setup();
  f.ports.secret = async () => null;
  await expect(f.media.inspect('c', 'pic', 'what')).rejects.toThrow('配置');
  expect(f.calls()).toBe(0);
  await expect(f.media.draw('c', 'cat', undefined, false)).rejects.toThrow('权限');
  await f.media.saveSettings({ ...defaultMediaSettings, drawingEnabled: true });
  await f.media.draw('c', 'cat', undefined, false);
  expect(f.draws()).toBe(1);
  await expect(f.media.draw('c', 'cat', undefined, true)).rejects.toThrow('权限');
});
it('passes uploaded pictures through inspection and sends a genuinely generated image via DSH', async () => {
  const f = await setup();
  await f.media.saveSettings({ ...defaultMediaSettings, drawingEnabled: true });
  let n = 0;
  const call = (name: string, args: unknown) => ({
    content: 'private',
    toolCalls: [{ id: `call${n}`, name, arguments: JSON.stringify(args) }],
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
      expect(JSON.stringify(request)).not.toContain('data:image');
      if (n === 1) {
        expect(JSON.stringify(request.messages)).toContain('pic');
        return call('inspect_image', { imageId: 'pic', question: '图里是什么' });
      }
      if (n === 2) {
        expect(JSON.stringify(request.messages)).toContain('粉色的猫');
        return call('send_message', { messages: ['这只粉猫有点可爱'] });
      }
      if (n === 3) return call('draw_image', { prompt: '一只蓝色的猫', referenceImageId: 'pic' });
      if (n === 4) return call('send_image', { imageId: 'generated', caption: '给你换了个配色' });
      return call('wait', { reason: '等对方' });
    },
  };
  const diag = new Diagnostics(f.store),
    agent = new CompanionAgent(f.store, async () => provider, diag, {
      media: f.media,
      web: {
        search: async () => [],
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
  const chat = new ChatService(f.store, async () => provider, diag, {
    agent: (input) => agent.run(input),
    retrieve: async () => [],
    afterRound: async () => {},
  });
  await chat.send(
    'c',
    '',
    () => {},
    () => {},
    undefined,
    undefined,
    undefined,
    ['pic'],
  );
  const history = await chat.history('c');
  expect(history[0].attachments).toEqual(['pic']);
  expect(history.at(-1)?.attachments).toEqual(['generated']);
  expect(f.calls()).toBe(1);
  expect(f.draws()).toBe(1);
  expect(JSON.stringify((await f.store.get('agentSessions', 'c'))?.events)).not.toContain(
    'TEST_IMAGE_BYTES',
  );
});
it('saves image settings without generation and keeps shared credentials bound to one origin', async () => {
  const { saveMediaConfiguration } = await import('../src/application/media-settings');
  const { defaultImageSettings } = await import('../src/appearance/model');
  const f = await setup();
  let stored = '';
  const secrets = {
    get: async () => stored || null,
    set: async (key: string) => {
      stored = key;
    },
  };
  await saveMediaConfiguration(
    f.store,
    { ...defaultMediaSettings, drawingEnabled: true },
    defaultImageSettings,
    { vision: 'own-key', drawing: '' },
    { vision: secrets, image: secrets },
  );
  expect(f.draws()).toBe(0);
  expect(f.calls()).toBe(0);
  expect((await f.store.get('imageSettings', 'images'))?.provider).toBe('seedream');
  await expect(
    saveMediaConfiguration(
      f.store,
      { ...defaultMediaSettings, visionBaseUrl: 'https://other.example' },
      defaultImageSettings,
      { vision: 'new-key', drawing: '' },
      { vision: secrets, image: secrets },
    ),
  ).rejects.toThrow('同域');
  expect(stored).toBe('own-key');
});
it('counts uncertain paid attempts toward the limit and reuses completed image requests', async () => {
  const f = await setup();
  await f.media.saveSettings({ ...defaultMediaSettings, drawingEnabled: true });
  await f.media.draw('c', 'same', undefined, false);
  await f.media.draw('c', 'same', undefined, false);
  expect(f.draws()).toBe(1);
  f.ports.generate = async () => {
    throw Error('请求结果未知');
  };
  for (let i = 0; i < 4; i++)
    await expect(f.media.draw('c', `attempt${i}`, undefined, false)).rejects.toThrow('未知');
  await expect(f.media.draw('c', 'sixth', undefined, false)).rejects.toThrow('5次');
});
