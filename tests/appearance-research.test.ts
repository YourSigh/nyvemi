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

it('routes a named original and an implicit design to creation without any public search, even when identity confidence is low', async () => {
  const web = { search: vi.fn(), read: vi.fn(), imageSearch: vi.fn() };
  const model: LLMProvider = {
    chat: vi.fn(),
    streamChat: vi.fn(),
    structuredOutput: async (_m, schema) =>
      schema.parse({
        brief: { ...brief, subject: '', namedCharacter: false, confidence: 0.4 },
        queries: ['不应执行的查询'],
      }),
  };
  const director = new DSVisualDirector(async () => model, web, assets, hash);
  for (const description of [
    '原创角色云芽，短发机械师，蓝灰色工作服',
    '画一个橙发、戴圆眼镜的爵士乐手',
  ]) {
    expect(await director.research({ description, mode: 'text' })).toMatchObject({
      status: 'ready',
      references: [],
      brief: { namedCharacter: false },
    });
  }
  expect(web.search).not.toHaveBeenCalled();
  expect(web.read).not.toHaveBeenCalled();
  expect(web.imageSearch).not.toHaveBeenCalled();
});
it('an uploaded original reference is reviewed directly without looking for an Internet counterpart', async () => {
  const web = { search: vi.fn(), read: vi.fn(), imageSearch: vi.fn() };
  const model: LLMProvider = {
    chat: vi.fn(),
    streamChat: vi.fn(),
    structuredOutput: async (_m, schema) =>
      schema.parse({ brief: { ...brief, namedCharacter: false }, queries: [] }),
    structuredVision: async (_m, _a, schema) => schema.parse(match),
  };
  const director = new DSVisualDirector(async () => model, web, assets, hash);
  const result = await director.research({
    description: '我的OC角色',
    mode: 'reference',
    reference: asset('own'),
  });
  expect(result).toMatchObject({
    status: 'awaiting_reference',
    references: [{ asset: asset('own') }],
  });
  expect(web.search).not.toHaveBeenCalled();
  expect(web.read).not.toHaveBeenCalled();
  expect(web.imageSearch).not.toHaveBeenCalled();
});
it('DS composes a real drawing prompt from the original request and grounded reference observations', async () => {
  const model: LLMProvider = {
    chat: vi.fn(),
    streamChat: vi.fn(),
    structuredOutput: async (messages, schema, purpose) => {
      expect(purpose).toBe('visual_prompt_composition');
      expect(JSON.parse(messages[1].content)).toMatchObject({
        description: '我的蓝发机械师',
        brief: { recognizableFeatures: ['蓝发'] },
      });
      return schema.parse({ prompt: '单人蓝发机械师，灰色工作服，正面全身中立站姿，简单背景。' });
    },
  };
  const director = new DSVisualDirector(
    async () => model,
    { search: vi.fn(), read: vi.fn() },
    assets,
    hash,
  );
  expect(
    await director.composePrompt({
      description: '我的蓝发机械师',
      mode: 'text',
      brief: { ...brief, namedCharacter: false, recognizableFeatures: ['蓝发'] },
    }),
  ).toContain('灰色工作服');
});
it('persists one compiled original design before paid calls and reuses it after restart and partial failure', async () => {
  const { store, service, provider } = await fixture();
  provider.supportsPromptPlanning = true;
  provider.composePrompt = vi.fn(
    async () => '蓝发原创画家，白色围裙，正面全身站姿，双手分开，简洁背景。',
  );
  vi.mocked(provider.research!).mockResolvedValue({
    version: 1,
    brief: { ...brief, namedCharacter: false },
    references: [],
    status: 'ready',
  });
  const input = { description: '原创蓝发画家', mode: 'text' as const };
  const draft = await service.generate('c', input, { planOnly: true });
  expect(draft).toMatchObject({
    promptVersion: 4,
    imagePrompt: expect.stringContaining('白色围裙'),
  });
  expect(provider.candidate).not.toHaveBeenCalled();
  vi.mocked(provider.candidate).mockImplementationOnce(async (planned) => {
    expect((await store.get('visualDrafts', 'c'))?.imagePrompt).toEqual(planned.imagePrompt);
    throw Error('image offline');
  });
  await expect(service.generate('c', input)).rejects.toThrow('offline');
  await new VisualCreationService(store, async () => provider, assets).generate('c', input);
  expect(provider.composePrompt).toHaveBeenCalledOnce();
  for (const [planned] of vi.mocked(provider.candidate).mock.calls)
    expect(planned.imagePrompt).toBe(draft.imagePrompt);
});
it('a failed DS prompt never falls through to a paid raw-text generation', async () => {
  const { provider, service } = await fixture();
  provider.supportsPromptPlanning = true;
  provider.composePrompt = vi.fn(async () => {
    throw Error('DS unavailable');
  });
  vi.mocked(provider.research!).mockResolvedValue({
    version: 1,
    brief: { ...brief, namedCharacter: false },
    references: [],
    status: 'ready',
  });
  await expect(service.generate('c', { description: '原创画家', mode: 'text' })).rejects.toThrow(
    'DS unavailable',
  );
  expect(provider.candidate).not.toHaveBeenCalled();
});
it('compiles named-character prompts only after reference confirmation and preserves old paid v3 batches', async () => {
  const { provider, service } = await fixture();
  const input = { description: 'q版测试作品测试角色', mode: 'text' as const };
  await service.generate('c', input);
  provider.supportsPromptPlanning = true;
  provider.composePrompt = vi.fn(
    async () => '同一角色正面全身简化立绘，遵照已确认参考图保持服装和颜色。',
  );
  const old = await service.generate('c', input, { referenceId: 'ref' });
  expect(old.promptVersion).toBe(3);
  expect(provider.composePrompt).not.toHaveBeenCalled();
  await service.generate('c', input, { regenerate: true, planOnly: true });
  expect(provider.composePrompt).toHaveBeenCalledWith(
    expect.objectContaining({
      reference: asset('reference'),
      brief: expect.objectContaining({ recognizableFeatures: match.features }),
    }),
  );
});
it('Seedream uses the DS design in new requests and caches different designs independently', async () => {
  const { store } = await fixture();
  const http = vi.fn<typeof fetch>(async (_url, init) => {
    expect(JSON.parse(String(init?.body)).prompt).toContain('绘图方案：原创机械师');
    return new Response(
      JSON.stringify({ data: [{ url: 'https://cdn.example.org/out', size: '1024x1536' }] }),
    );
  });
  const p = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'test-key',
    store,
    assets,
    hash,
    http,
  );
  const input = {
    description: '原创机械师',
    mode: 'text' as const,
    promptVersion: 4 as const,
    imagePrompt: '原创机械师，蓝发，灰色工作服，正面全身站姿，简单背景。',
  };
  await p.candidate(input, 0);
  await p.candidate(input, 0);
  expect(http).toHaveBeenCalledOnce();
  await p.candidate({ ...input, imagePrompt: input.imagePrompt + '戴圆眼镜。' }, 0);
  expect(http).toHaveBeenCalledTimes(2);
  await expect(p.candidate({ ...input, imagePrompt: undefined }, 0)).rejects.toThrow('缺少DS');
  expect(http).toHaveBeenCalledTimes(2);
});

it('normalizes display observations and harmless extra metadata while keeping the identity decision strict', async () => {
  const { VisualCheckSchema } = await import('../src/appearance/research');
  const result = VisualCheckSchema.parse({
    checks: [
      {
        status: 'uncertain',
        features: Array(9).fill('a'.repeat(200)),
        issues: ['看不清'],
        explanation: 'extra display note',
      },
    ],
    reasoning: 'not used',
  });
  expect(result.status).toBe('uncertain');
  expect(result.features).toHaveLength(6);
  expect(result.features[0]).toHaveLength(120);
  expect(result.issues).toEqual(['看不清']);
  expect(result).not.toHaveProperty('explanation');
  for (const bad of [
    { status: 'approved', features: [], issues: [] },
    { status: 'match', features: [1], issues: [] },
    { checks: [match, match] },
    { status: 'match', issues: [] },
  ])
    expect(VisualCheckSchema.safeParse(bad).success).toBe(false);
});
it('ignores planning comments and extra observations but does not coerce the identity gate or invent a missing prompt', async () => {
  const web = { search: vi.fn(), read: vi.fn() };
  const model: LLMProvider = {
    chat: vi.fn(),
    streamChat: vi.fn(),
    structuredOutput: async (_m, schema, purpose) =>
      schema.parse(
        purpose === 'visual_identity_planning'
          ? {
              brief: {
                ...brief,
                subject: null,
                namedCharacter: false,
                recognizableFeatures: Array(9).fill('蓝发'),
                comment: 'extra',
              },
              reasoning: 'extra',
            }
          : { comment: 'no prompt supplied' },
      ),
  };
  const director = new DSVisualDirector(async () => model, web, assets, hash);
  expect(await director.research({ description: '原创蓝发角色', mode: 'text' })).toMatchObject({
    status: 'ready',
    brief: { subject: '原创角色', recognizableFeatures: Array(8).fill('蓝发') },
  });
  expect(web.search).not.toHaveBeenCalled();
  await expect(
    director.composePrompt({ description: '原创蓝发角色', mode: 'text' }),
  ).rejects.toThrow();
  model.structuredOutput = async (_m, schema) =>
    schema.parse({ brief: { ...brief, namedCharacter: 'false' }, queries: [] });
  await expect(director.classify({ description: '原创蓝发角色', mode: 'text' })).rejects.toThrow();
});

it('resumes uploaded-reference creation through format failures and a failed download without repeating drawing requests', async () => {
  const { store } = await fixture();
  const reference = asset('uploaded-reference');
  const input = {
    description: '原创短发运动员，蓝衣服，黄鞋',
    mode: 'reference' as const,
    reference,
  };
  const extraObservations = {
    checks: [{ ...match, features: Array(7).fill('蓝衣服'), comment: '额外说明' }],
  };
  const imagePrompt = '绘制短发的原创运动员，穿蓝色运动服和黄色运动鞋，正面全身站姿。';
  const modelResponse = (content: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  const plan = { brief: { ...brief, subject: '', namedCharacter: false }, queries: [] };
  const ds = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(async () => modelResponse(plan))
    .mockImplementationOnce(async () => modelResponse({ ...match, status: 'invalid' }))
    .mockImplementationOnce(async () => modelResponse(plan))
    .mockImplementationOnce(async () => modelResponse(extraObservations))
    .mockImplementationOnce(async () => modelResponse({ prompt: imagePrompt }))
    .mockImplementationOnce(async () => modelResponse({ ...match, status: 'invalid' }))
    .mockImplementation(async () => modelResponse(extraObservations));
  let drawings = 0;
  const ark = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.prompt).toContain(imagePrompt);
    if (drawings === 0) expect(body.image).toBe('data:image/png;base64,file://uploaded-reference');
    drawings++;
    return new Response(
      JSON.stringify({
        data: [{ url: `https://cdn.example.org/out-${drawings}`, size: '1024x1536' }],
      }),
    );
  });
  const files = {
    ...assets,
    download: vi
      .fn(async (_url: string, name: string) => asset(name))
      .mockRejectedValueOnce(Error('下载中断')),
  };
  const web = { search: vi.fn(), read: vi.fn() };
  // Construct new service/provider instances on every attempt, as the screen does on resume.
  const service = () =>
    new VisualCreationService(
      store,
      async () => {
        const model = new OpenAICompatibleProvider(
          deepSeekPreset,
          { get: async () => 'test-key', set: vi.fn(), remove: vi.fn() },
          async () => {},
          ds,
        );
        const director = new DSVisualDirector(async () => model, web, files, hash);
        return new SeedreamImageProvider(
          defaultImageSettings,
          async () => 'test-key',
          store,
          files,
          hash,
          ark,
          undefined,
          director,
        );
      },
      files,
    );

  await expect(service().generate('c', input, { planOnly: true })).rejects.toMatchObject({
    details: { purpose: 'visual_reference_review', reason: 'schema' },
  });
  expect((await store.get('visualDrafts', 'c'))?.input.reference).toEqual(reference);
  const prepared = await service().generate('c', input, { planOnly: true });
  expect(prepared.research?.references[0].check.features).toHaveLength(6);
  expect(prepared.research?.status).toBe('awaiting_reference');
  expect(ark).not.toHaveBeenCalled();
  expect(web.search).not.toHaveBeenCalled();

  const referenceId = prepared.research!.references[0].id;
  await expect(service().generate('c', input, { referenceId })).rejects.toThrow('下载中断');
  expect((await store.list('imageRequests'))[0].status).toBe('received');
  await expect(service().generate('c', input)).rejects.toMatchObject({
    details: { purpose: 'visual_candidate_review', reason: 'schema' },
  });
  const interrupted = await store.get('visualDrafts', 'c');
  expect(interrupted?.candidates).toHaveLength(1);
  expect(ark).toHaveBeenCalledOnce();

  const done = await service().generate('c', input);
  expect(done.candidates).toHaveLength(3);
  expect(done.candidates[0]).toEqual(interrupted?.candidates[0]);
  expect(done.candidateReviews?.map((review) => review?.status)).toEqual([
    'match',
    'match',
    'match',
  ]);
  expect(ark).toHaveBeenCalledTimes(3);
  const modelCalls = ds.mock.calls.length;
  await service().generate('c', input);
  expect(ark).toHaveBeenCalledTimes(3);
  expect(ds).toHaveBeenCalledTimes(modelCalls);
});
