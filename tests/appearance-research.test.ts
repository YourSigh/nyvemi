import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  DSVisualDirector,
  type VisualResearch,
  type VisualCheck,
} from '../src/appearance/research';
import {
  MockImageProvider,
  VisualCreationService,
  type ImageAssets,
  type ImageProvider,
} from '../src/appearance/service';
import { SeedreamImageProvider } from '../src/appearance/seedream';
import { defaultImageSettings } from '../src/appearance/model';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type LLMProvider } from '../src/providers/provider';
import { pageImages } from '../src/agent/web';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona } from './persona-fixture';
const hash = async (s: string) => createHash('sha256').update(s).digest('hex');
const asset = (name: string) => ({ uri: `file://${name}`, width: 1024, height: 1536 });
const match: VisualCheck = { status: 'match', features: ['原图中可见的发型'], issues: [] };
const brief = {
  subject: '测试作品 测试角色',
  namedCharacter: true,
  recognizableFeatures: [],
  style: 'q版',
  confidence: 0.95,
};
const research = (): VisualResearch => ({
  version: 1,
  brief,
  status: 'awaiting_reference',
  references: [
    {
      id: 'ref',
      title: '实际资料页',
      sourceUrl: 'https://example.org/character',
      asset: asset('reference'),
      check: match,
    },
  ],
});
const assets: ImageAssets = {
  fingerprint: async (a) => a.uri,
  dataUrl: async (a) => `data:image/png;base64,${a.uri}`,
  download: vi.fn(async (_url, name) => asset(name)),
  exists: async () => true,
};
async function fixture() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    createdAt: 1,
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  });
  const mock = new MockImageProvider();
  const provider: ImageProvider = {
    ...mock,
    identity: mock.identity,
    supportsResearch: true,
    research: vi.fn(async () => research()),
    candidate: vi.fn(async (_i, n) => asset(`candidate-${n}`)),
    review: vi.fn(async () => match),
    split: vi.fn(mock.split.bind(mock)),
  };
  return {
    store,
    provider,
    service: new VisualCreationService(store, async () => provider, assets),
  };
}
it('discovers only actual public page images and rejects inline, private and duplicate locations', () => {
  const found = pageImages(
    '<meta property="og:image" content="/main.png?a=1&amp;b=2"><img src="/main.png?a=1&amp;b=2"><img data-src="https://cdn.example.org/full.webp" alt="立绘"><img src="https://127.0.0.1/a"><img src="data:image/png;base64,abc"><img src="/logo.svg">',
    'https://example.org/role',
  );
  expect(found.map((a) => a.url)).toEqual([
    'https://example.org/main.png?a=1&b=2',
    'https://cdn.example.org/full.webp',
  ]);
});
it('does not spend on images before a human confirms a researched reference; shares that reference and an approved anchor', async () => {
  const { store, provider, service } = await fixture();
  const input = { description: 'q版测试作品测试角色', mode: 'text' as const };
  const pending = await service.generate('c', input);
  expect(pending.research?.status).toBe('awaiting_reference');
  expect(provider.candidate).not.toHaveBeenCalled();
  await service.generate('c', input, { referenceId: 'invented' });
  expect(provider.candidate).not.toHaveBeenCalled();
  const done = await service.generate('c', input, { referenceId: 'ref' });
  expect(done.candidates).toHaveLength(3);
  expect(provider.research).toHaveBeenCalledOnce();
  expect(vi.mocked(provider.candidate).mock.calls[0][0].reference).toEqual(asset('reference'));
  expect(vi.mocked(provider.candidate).mock.calls[1][0].anchor).toEqual(asset('candidate-0'));
  await service.generate('c', input);
  expect(provider.candidate).toHaveBeenCalledTimes(3);
  expect(provider.review).toHaveBeenCalledTimes(3);
  expect((await store.get('visualDrafts', 'c'))?.confirmedReferenceId).toBe('ref');
});
it('persists paid images before a failed vision check; retry reuses images and blocks decomposition until verified', async () => {
  const { store, provider, service } = await fixture();
  const input = { description: 'q版测试角色', mode: 'text' as const };
  await service.generate('c', input);
  vi.mocked(provider.review!).mockRejectedValueOnce(Error('vision offline'));
  await expect(service.generate('c', input, { referenceId: 'ref' })).rejects.toThrow('offline');
  expect((await store.get('visualDrafts', 'c'))?.candidates).toHaveLength(1);
  await expect(service.select('c', 0)).rejects.toThrow('尚未通过');
  await service.generate('c', input);
  expect(provider.candidate).toHaveBeenCalledTimes(3);
  await service.select('c', 0);
  expect(provider.split).toHaveBeenCalledOnce();
});
it('does not promote a mismatched candidate or use it as an identity anchor', async () => {
  const { provider, service } = await fixture();
  const input = { description: 'q版测试角色', mode: 'text' as const };
  await service.generate('c', input);
  vi.mocked(provider.review!).mockResolvedValueOnce({
    status: 'mismatch',
    features: [],
    issues: ['发型改变'],
  });
  await service.generate('c', input, { referenceId: 'ref' });
  expect(vi.mocked(provider.candidate).mock.calls[1][0].anchor).toBeUndefined();
  await expect(service.select('c', 0)).rejects.toThrow('尚未通过');
  expect(provider.split).not.toHaveBeenCalled();
});
it('keeps a research miss explicit instead of silently charging a name-only generation', async () => {
  const { provider, service } = await fixture();
  vi.mocked(provider.research!).mockResolvedValue({
    version: 1,
    brief,
    references: [],
    status: 'needs_reference',
  });
  const result = await service.generate('c', { description: 'q版测试角色', mode: 'text' });
  expect(result.research?.status).toBe('needs_reference');
  expect(provider.candidate).not.toHaveBeenCalled();
});
it('DS selects actual fetched images by index, visually checks them, and cannot create a URL', async () => {
  const model: LLMProvider = {
    chat: vi.fn(),
    streamChat: vi.fn(),
    structuredOutput: async (_m, schema, purpose) =>
      schema.parse(
        purpose === 'visual_identity_planning'
          ? { brief, queries: ['测试作品 测试角色 官方立绘'] }
          : { indices: [0] },
      ),
    structuredVision: async (_p, images, schema) => {
      expect(images).toHaveLength(1);
      return schema.parse({ checks: [match] });
    },
  };
  const web = {
    search: vi.fn(async () => [
      { title: '资料', url: 'https://example.org/character', text: '资料', source: 'search' },
    ]),
    read: vi.fn(async () => ({
      title: '角色资料',
      url: 'https://example.org/character',
      text: '人物资料',
      source: 'web-page',
      images: [{ url: 'https://cdn.example.org/ref.png', alt: '立绘' }],
    })),
  };
  const localAssets = { ...assets, download: vi.fn(async () => asset('ref')) };
  const director = new DSVisualDirector(async () => model, web, localAssets, hash);
  const result = await director.research({ description: 'q版测试作品测试角色', mode: 'text' });
  expect(result.references[0].sourceUrl).toBe('https://example.org/character');
  expect(localAssets.download).toHaveBeenCalledWith(
    'https://cdn.example.org/ref.png',
    expect.any(String),
  );
  expect(result.status).toBe('awaiting_reference');
});
it('OpenAI-compatible vision transport sends actual image content and records usage under the review purpose', async () => {
  const metrics = vi.fn(async () => {});
  const http = vi.fn<typeof fetch>(async (_url, options) => {
    const request = JSON.parse(String(options?.body));
    expect(request.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAA' },
    });
    expect(request.thinking).toEqual({ type: 'disabled' });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );
  });
  const model = new OpenAICompatibleProvider(
    deepSeekPreset,
    { get: async () => 'test-key', set: vi.fn(), remove: vi.fn() },
    metrics,
    http,
  );
  expect(
    await model.structuredVision(
      '检查',
      ['data:image/png;base64,AAAA'],
      z.object({ ok: z.boolean() }),
      'visual_candidate_review',
    ),
  ).toEqual({ ok: true });
  expect(metrics).toHaveBeenCalledWith(
    expect.objectContaining({
      purpose: 'visual_candidate_review',
      inputTokens: 12,
      outputTokens: 3,
    }),
  );
});
it('Seedream receives the confirmed reference and passed anchor, not just a longer text prompt', async () => {
  const { store } = await fixture();
  const http = vi.fn<typeof fetch>(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    expect(body.image).toEqual([
      'data:image/png;base64,file://reference',
      'data:image/png;base64,file://candidate-0',
    ]);
    expect(body.prompt).toContain('图1是用户确认');
    return new Response(
      JSON.stringify({ data: [{ url: 'https://cdn.example.org/out', size: '1024x1536' }] }),
    );
  });
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'test-key',
    store,
    assets,
    hash,
    http,
  );
  const input = {
    description: 'q版测试角色',
    mode: 'text' as const,
    reference: asset('reference'),
    anchor: asset('candidate-0'),
    promptVersion: 3 as const,
  };
  await provider.candidate(input, 1);
  await provider.candidate(input, 1);
  expect(http).toHaveBeenCalledOnce();
});
it('can plan an original character without an image key or an image request', async () => {
  const { service, provider } = await fixture();
  vi.mocked(provider.research!).mockResolvedValue({
    version: 1,
    brief: { ...brief, namedCharacter: false },
    references: [],
    status: 'ready',
  });
  const input = { description: '原创角色，安静的蓝发画家', mode: 'text' as const };
  const draft = await service.generate('c', input, { planOnly: true });
  expect(draft.research?.status).toBe('ready');
  expect(provider.candidate).not.toHaveBeenCalled();
  await service.generate('c', input);
  expect(provider.candidate).toHaveBeenCalledTimes(3);
});
it('does not let several homepage logos suppress the dedicated character image search', async () => {
  const web = {
    search: vi.fn(async () =>
      [0, 1, 2, 3].map((i) => ({
        url: `https://example.org/home-${i}`,
        title: '作品官网',
        text: '',
        source: 'search',
      })),
    ),
    read: vi.fn(async (url: string) => ({
      url,
      title: '官网首页',
      text: '',
      source: 'web-page',
      images: [0, 1, 2, 3].map((i) => ({
        url: `https://cdn.example.org/logo-${i}.png`,
        alt: 'Logo',
      })),
    })),
    imageSearch: vi.fn(async () => [
      {
        url: 'https://example.org/character',
        title: '测试角色立绘',
        text: '角色形象',
        source: 'web-image-search',
        images: [{ url: 'https://cdn.example.org/character.png', alt: '角色' }],
      },
    ]),
  };
  const model: LLMProvider = {
    chat: vi.fn(),
    streamChat: vi.fn(),
    structuredOutput: async (messages, schema, purpose) => {
      if (purpose === 'visual_identity_planning')
        return schema.parse({ brief, queries: ['作品官方网站'] });
      const input = JSON.parse(messages[1].content) as { candidates: { image: string }[] };
      const index = input.candidates.findIndex((r) => r.image.endsWith('/character.png'));
      expect(index).toBeGreaterThanOrEqual(0);
      return schema.parse({ indices: [index] });
    },
    structuredVision: async (_p, _a, schema) => schema.parse({ checks: [match] }),
  };
  const director = new DSVisualDirector(async () => model, web, assets, hash);
  const result = await director.research({ description: 'q版测试作品测试角色', mode: 'text' });
  expect(web.imageSearch).toHaveBeenCalledWith(`${brief.subject} 立绘`, expect.any(AbortSignal));
  expect(result.references).toHaveLength(1);
});
