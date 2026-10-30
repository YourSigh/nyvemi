import { expect, it } from 'vitest';
import { MediaService, type MediaPorts } from '../src/media/service';
import { defaultMediaSettings, MediaSettingsSchema, type MediaAsset } from '../src/media/model';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona, defaultSettings } from '../src/domain/models';
import { CompanionAgent } from '../src/agent/service';
import { Diagnostics } from '../src/storage/diagnostics';
import { ChatService } from '../src/chat/service';
import { deepSeekPreset, type ApiMetric, type LLMProvider } from '../src/providers/provider';
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
  await store.put('provider', deepSeekPreset);
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
    chatVision: async () => {
      const config = await store.get('provider', 'provider');
      return config ? { ...config, key: 'chat-test-secret' } : null;
    },
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
  f.ports.chatVision = async () => ({ ...deepSeekPreset, key: null });
  await expect(f.media.inspect('c', 'pic', 'what')).rejects.toThrow('填写聊天API Key');
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
    {
      ...defaultMediaSettings,
      visionSource: 'custom',
      visionBaseUrl: defaultImageSettings.baseUrl,
      reuseImageKey: true,
      drawingEnabled: true,
    },
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
      {
        ...defaultMediaSettings,
        visionSource: 'custom',
        reuseImageKey: true,
        visionBaseUrl: 'https://other.example',
      },
      defaultImageSettings,
      { vision: 'new-key', drawing: '' },
      { vision: secrets, image: secrets },
    ),
  ).rejects.toThrow('同域');
  expect(stored).toBe('own-key');
});
it('defaults to the current chat model and key, without reading or sending the drawing key', async () => {
  const f = await setup();
  f.ports.secret = async () => {
    throw Error('must not read image/vision key');
  };
  f.ports.request = (async (url, init) => {
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer chat-test-secret');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('deepseek-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages[1].content[1].image_url.url).toContain('data:image');
    return new Response(JSON.stringify({ choices: [{ message: { content: '看到了' } }] }));
  }) as typeof fetch;
  expect((await f.media.settings()).visionSource).toBe('chat');
  await f.media.inspect('c', 'pic', 'what');
  expect(f.metrics[0].endpoint).toBe(deepSeekPreset.baseUrl);
  expect(f.metrics[0].model).toBe(deepSeekPreset.model);
});
it('keeps legacy explicitly configured vision endpoints and separates their key from chat credentials', async () => {
  const f = await setup();
  const { visionSource: _source, ...legacy } = {
    ...defaultMediaSettings,
    visionBaseUrl: 'https://vision.example/v1',
    visionModel: 'custom-vision',
    reuseImageKey: false,
  };
  expect(MediaSettingsSchema.parse(legacy).visionSource).toBe('custom');
  await f.store.put('mediaSettings', legacy as typeof defaultMediaSettings);
  f.ports.chatVision = async () => {
    throw Error('must not read chat key');
  };
  f.ports.request = (async (url, init) => {
    expect(url).toBe('https://vision.example/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer vision-test-secret',
    );
    return new Response(JSON.stringify({ choices: [{ message: { content: '独立识图' } }] }));
  }) as typeof fetch;
  expect(await f.media.inspect('c', 'pic', 'what')).toBe('独立识图');
});
it('does not reuse observations after changing chat provider, or send unsupported DeepSeek models images', async () => {
  const f = await setup();
  await f.media.inspect('c', 'pic', 'what');
  await f.store.put('provider', {
    ...deepSeekPreset,
    baseUrl: 'https://other.example/v1',
    model: 'vision-model',
  });
  await f.media.inspect('c', 'pic', 'what');
  expect(f.calls()).toBe(2);
  expect(f.metrics[1].endpoint).toBe('https://other.example/v1');
  await f.store.put('provider', { ...deepSeekPreset, model: 'deepseek-pro' });
  await expect(f.media.inspect('c', 'pic', 'what')).rejects.toThrow('deepseek-flash');
  expect(f.calls()).toBe(2);
});
it('saves drawing credentials independently when chat handles vision, without requiring a visual key', async () => {
  const { saveMediaConfiguration } = await import('../src/application/media-settings');
  const { defaultImageSettings } = await import('../src/appearance/model');
  const f = await setup();
  let drawingKey = '';
  const forbidden = async () => {
    throw Error('must not access dedicated vision secret');
  };
  await saveMediaConfiguration(
    f.store,
    { ...defaultMediaSettings, drawingEnabled: true },
    defaultImageSettings,
    { vision: '', drawing: 'drawing-only-key' },
    {
      vision: { get: forbidden, set: forbidden },
      image: {
        get: async (base) => {
          expect(base).toBe(defaultImageSettings.baseUrl);
          return drawingKey || null;
        },
        set: async (key, base) => {
          expect(base).toBe(defaultImageSettings.baseUrl);
          drawingKey = key;
        },
      },
    },
  );
  expect(drawingKey).toBe('drawing-only-key');
  expect(f.calls()).toBe(0);
  expect(f.draws()).toBe(0);
});
it('reports a failed chat vision call without falling back to a different paid provider', async () => {
  const f = await setup();
  f.ports.secret = async () => {
    throw Error('must not read drawing credentials');
  };
  let requests = 0;
  f.ports.request = (async (url) => {
    requests++;
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    return new Response('', { status: 400 });
  }) as typeof fetch;
  await expect(f.media.inspect('c', 'pic', 'what')).rejects.toThrow('HTTP 400');
  expect(requests).toBe(1);
  expect(f.metrics[0]).toMatchObject({
    success: false,
    endpoint: deepSeekPreset.baseUrl,
    purpose: 'image_understanding',
  });
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
