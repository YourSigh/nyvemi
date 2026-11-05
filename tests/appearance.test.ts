import { demoPersona } from './persona-fixture';
import { createHash } from 'node:crypto';
import { it, expect, vi } from 'vitest';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { defaultSettings } from '../src/domain/models';
import {
  MockImageProvider,
  VisualCreationService,
  validateImageSettings,
  type ImageAssets,
} from '../src/appearance/service';
import { SeedreamImageProvider } from '../src/appearance/seedream';
import { defaultImageSettings, validateRig } from '../src/appearance/model';
import { mockRig } from '../src/appearance/mock';
async function setup() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const character = {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 0.5, relationshipCloseness: 0.3, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  };
  await store.put('characters', character);
  await store.put('settings', defaultSettings('c'));
  const assets: ImageAssets = {
    fingerprint: async (a) => a.uri,
    dataUrl: async () => 'data:image/png;base64,AAAA',
    download: async (url, key) => ({ uri: `file://${key}`, width: 1024, height: 1024 }),
    exists: async () => true,
  };
  return { store, assets };
}
const hash = async (value: string) => createHash('sha256').update(value).digest('hex');
it('completes three candidate selection, rig validation and save without changing persona or history', async () => {
  const { store, assets } = await setup();
  const provider = new MockImageProvider();
  const spy = vi.spyOn(provider, 'candidate');
  const service = new VisualCreationService(store, async () => provider, assets);
  const input = { description: 'blue haired girl', mode: 'text' as const };
  const draft = await service.generate('c', input);
  expect(new Set(draft.candidates.map((c) => c.svg)).size).toBe(3);
  await service.generate('c', input);
  expect(spy).toHaveBeenCalledTimes(3);
  await service.select('c', 1);
  await service.save('c');
  expect((await store.get('characters', 'c'))?.rig?.layers.some((l) => l.role === 'eyes')).toBe(
    true,
  );
  expect((await store.get('characters', 'c'))?.persona).toEqual(demoPersona('c'));
});
it('supports direct reference mode and refuses missing references or invalid layers', async () => {
  const { store, assets } = await setup();
  const provider = new MockImageProvider();
  const candidate = vi.spyOn(provider, 'candidate');
  const service = new VisualCreationService(store, async () => provider, assets);
  await expect(service.generate('c', { description: 'x', mode: 'animate' })).rejects.toThrow(
    '参考图',
  );
  const draft = await service.generate('c', {
    description: 'x',
    mode: 'animate',
    reference: { uri: 'file://reference', width: 100, height: 100 },
  });
  expect(candidate).not.toHaveBeenCalled();
  expect(draft.selected?.uri).toBe('file://reference');
  await service.select('c');
  await service.save('c');
  const rig = mockRig('a');
  rig.layers = rig.layers.filter((l) => l.role !== 'eyes');
  expect(() => validateRig(rig)).toThrow('eyes');
});
it('keeps successful candidates across partial failure and rejects changed provider reuse', async () => {
  const { store, assets } = await setup();
  const provider = new MockImageProvider();
  const original = provider.candidate.bind(provider);
  const spy = vi
    .spyOn(provider, 'candidate')
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementation(original);
  const service = new VisualCreationService(store, async () => provider, assets);
  const input = { description: 'x', mode: 'text' as const };
  await expect(service.generate('c', input)).rejects.toThrow('offline');
  expect((await store.get('visualDrafts', 'c'))?.candidates).toHaveLength(1);
  await service.generate('c', input);
  expect(spy).toHaveBeenCalledTimes(4);
  provider.identity = 'different';
  await expect(service.select('c', 0)).rejects.toThrow('已改变');
});
it('persists paid response before downloading and retries without paying twice', async () => {
  const { store, assets } = await setup();
  const http = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ data: [{ url: 'https://cdn.example/a.png', size: '1024x1024' }] }),
      ),
  );
  const download = vi
    .spyOn(assets, 'download')
    .mockRejectedValueOnce(new Error('download offline'))
    .mockResolvedValue({ uri: 'file://a', width: 1024, height: 1024 });
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'test-secret',
    store,
    assets,
    hash,
    http as typeof fetch,
  );
  const input = { description: 'pink', mode: 'text' as const };
  await expect(provider.candidate(input, 0)).rejects.toThrow('offline');
  await provider.candidate(input, 0);
  await provider.candidate(input, 0);
  expect(http).toHaveBeenCalledTimes(1);
  expect(download).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(await store.list('imageRequests'))).not.toContain('test-secret');
});
it('does not repeat ambiguous paid requests and allows retry after definitive rejection', async () => {
  const { store, assets } = await setup();
  const http = vi.fn().mockRejectedValue(new Error('timeout'));
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'secret',
    store,
    assets,
    hash,
    http,
  );
  const input = { description: 'x', mode: 'text' as const };
  await expect(provider.candidate(input, 0)).rejects.toThrow('中断');
  await expect(provider.candidate(input, 0)).rejects.toThrow('结果不确定');
  expect(http).toHaveBeenCalledTimes(1);
  http.mockResolvedValue(new Response('', { status: 401 }));
  await expect(provider.candidate(input, 1)).rejects.toThrow('401');
  http.mockResolvedValue(
    new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/x', size: '1024x1024' }] })),
  );
  await provider.candidate(input, 1);
  expect(http).toHaveBeenCalledTimes(3);
});
it('maps normalized 0..1000 layer bounds and requires functional facial layers', async () => {
  const { store, assets } = await setup();
  const data = [
    { url: 'https://cdn.example/base', size: '1024x1024', z_index: 0 },
    ...['body', 'head', 'eyes', 'mouth'].map((name, i) => ({
      url: `https://cdn.example/${name}`,
      size: '512x512',
      z_index: i + 1,
      name,
      description: 'Exclude eyes, mouth and head from this body layer',
      bounding_box: { normalized: [100, 200, 600, 700] },
    })),
  ];
  const http = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data })));
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'secret',
    store,
    assets,
    hash,
    http as typeof fetch,
  );
  const rig = await provider.split({ uri: 'file://ref', width: 1024, height: 1024 });
  rig.layers[0].bounds.forEach((n, i) => expect(n).toBeCloseTo([0.1, 0.2, 0.5, 0.5][i]));
  expect(rig.layers).toHaveLength(4);
  expect(rig.layers.map((l) => l.role)).toEqual(['body', 'head', 'eyes', 'mouth']);
  const request = JSON.parse(http.mock.calls[0]?.[1]?.body as string);
  expect(request.layer_decomposition).toBe(true);
});
it('rejects insecure or credential-bearing endpoint settings', () => {
  expect(() =>
    validateImageSettings({ ...defaultImageSettings, baseUrl: 'http://example.com' }),
  ).toThrow('HTTPS');
  expect(() =>
    validateImageSettings({ ...defaultImageSettings, baseUrl: 'https://key:secret@example.com' }),
  ).toThrow('HTTPS');
});
it('reports missing model activation without exposing server response details', async () => {
  const { store, assets } = await setup();
  const http = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ error: { code: 'ModelNotOpen', message: 'server-private-details' } }),
        { status: 404 },
      ),
  );
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'secret',
    store,
    assets,
    hash,
    http,
  );
  await expect(provider.split({ uri: 'file://ref', width: 1000, height: 1000 })).rejects.toThrow(
    '模型尚未开通',
  );
});
it('recovers locks after process restart but keeps ambiguous payment receipts', async () => {
  const { recoverVisualWork } = await import('../src/appearance/recovery');
  const { store } = await setup();
  const now = Date.now();
  await store.lease('visual-assets', now, 100000);
  await store.lease('visual:c', now, 100000);
  await store.put('imageRequests', { id: 'paid', createdAt: now, status: 'started' });
  await store.lease('image-request:paid', now, 100000);
  await recoverVisualWork(store);
  expect(await store.lease('visual-assets', now, 1000)).toBe(true);
  expect(await store.lease('visual:c', now, 1000)).toBe(true);
  expect(await store.get('imageRequests', 'paid')).toMatchObject({ status: 'started' });
});
it('repairs only the body and keeps the other paid layers without another split', async () => {
  const { store, assets } = await setup();
  const http = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              url: 'https://cdn.example/body',
              size: '1000x1000',
              z_index: 1,
              name: 'body',
              description: 'no eyes, head or mouth',
              bounding_box: { normalized: [100, 200, 900, 1000] },
            },
          ],
        }),
      ),
  );
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'secret',
    store,
    assets,
    hash,
    http,
  );
  const original = mockRig('original');
  original.source = 'seedream';
  const next = await provider.repairBody(
    { uri: 'file://ref', width: 1024, height: 1024 },
    original,
  );
  expect(next.layers.filter((l) => l.role !== 'body')).toEqual(
    original.layers.filter((l) => l.role !== 'body'),
  );
  expect(next.layers.find((l) => l.role === 'body')!.asset.uri).not.toEqual(
    original.layers.find((l) => l.role === 'body')!.asset.uri,
  );
  await provider.repairBody({ uri: 'file://ref', width: 1024, height: 1024 }, original);
  expect(http).toHaveBeenCalledTimes(1);
});
it('does not charge another body repair for the same selected appearance', async () => {
  const { store, assets } = await setup();
  const mock = new MockImageProvider();
  const repairBody = vi.fn(async (_image: unknown, rig: ReturnType<typeof mockRig>) => rig);
  const provider = {
    identity: mock.identity,
    candidate: mock.candidate.bind(mock),
    split: mock.split.bind(mock),
    repairBody,
  };
  const service = new VisualCreationService(store, async () => provider, assets);
  await service.generate('c', { description: 'x', mode: 'text' });
  await service.select('c', 0);
  await service.repairBody('c');
  await service.repairBody('c');
  expect(repairBody).toHaveBeenCalledTimes(1);
  await service.select('c', 1);
  await service.repairBody('c');
  expect(repairBody).toHaveBeenCalledTimes(2);
});
it('illustrates ordinary chat prompts without rig constraints and reuses paid results', async () => {
  const { store, assets } = await setup();
  let prompt = '';
  const http = vi.fn(async (_url, init) => {
    prompt = JSON.parse(String(init?.body)).prompt;
    return new Response(
      JSON.stringify({ data: [{ url: 'https://cdn.example/art.png', size: '1024x1024' }] }),
    );
  });
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'test-key',
    store,
    assets,
    hash,
    http as typeof fetch,
  );
  await provider.illustrate('画一片安静的海');
  await provider.illustrate('画一片安静的海');
  expect(prompt).toBe('画一片安静的海');
  expect(http).toHaveBeenCalledTimes(1);
  const canceled = new AbortController();
  canceled.abort();
  await expect(provider.illustrate('another', undefined, canceled.signal)).rejects.toThrow('取消');
  expect(http).toHaveBeenCalledTimes(1);
});

it('locks named-character identity and shares one cached brief across all candidates and retries', async () => {
  const { store, assets } = await setup();
  const brief = {
    subject: '原神·纳西妲',
    namedCharacter: true,
    recognizableFeatures: [
      '银白发带绿色发梢，保留原本侧马尾',
      '绿色眼睛',
      '白绿配色与叶片纹样服饰',
    ],
    style: 'Q版，约2至3头身',
    confidence: 0.95,
  };
  const planner = vi.fn(async () => brief),
    prompts: string[] = [];
  const http = vi.fn<typeof fetch>(async (_url, init) => {
    prompts.push(JSON.parse(String(init?.body)).prompt);
    return new Response(
      JSON.stringify({ data: [{ url: 'https://cdn.example/named', size: '1024x1024' }] }),
    );
  });
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'test-key',
    store,
    assets,
    hash,
    http,
    planner,
  );
  const service = new VisualCreationService(store, async () => provider, assets);
  const input = { description: 'Q版原神纳西妲', mode: 'text' as const };
  const draft = await service.generate('c', input);
  expect(draft.brief).toEqual(brief);
  expect(draft.input.description).toBe(input.description);
  expect(planner).toHaveBeenCalledOnce();
  expect(prompts).toHaveLength(3);
  for (const prompt of prompts) {
    expect(prompt).toContain('原神·纳西妲');
    expect(prompt).toContain('绿色眼睛');
    expect(prompt).toContain('保留标志性发型');
    expect(prompt).not.toContain('Create one original');
    expect(prompt).not.toContain('Design variation');
  }
  await new VisualCreationService(store, async () => provider, assets).generate('c', input);
  expect(planner).toHaveBeenCalledOnce();
  expect(http).toHaveBeenCalledTimes(3);
});
it('makes an explicit new candidate batch without reusing old images, then resumes that batch normally', async () => {
  const { store, assets } = await setup();
  const http = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ data: [{ url: 'https://cdn.example/new', size: '1024x1024' }] }),
      ),
  );
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'test-key',
    store,
    assets,
    hash,
    http,
  );
  const service = new VisualCreationService(store, async () => provider, assets);
  const input = { description: 'generic original humanoid character', mode: 'text' as const };
  const original = await service.generate('c', input);
  const fresh = await service.generate('c', input, { regenerate: true });
  expect(fresh.generationId).toBeTruthy();
  expect(fresh.candidates.map((a) => a.uri)).not.toEqual(original.candidates.map((a) => a.uri));
  expect(http).toHaveBeenCalledTimes(6);
  expect((await service.generate('c', input)).candidates).toEqual(fresh.candidates);
  expect(http).toHaveBeenCalledTimes(6);
});
it('does not bypass an unfinished paid batch with another regeneration request', async () => {
  const { store, assets } = await setup();
  const provider = new MockImageProvider();
  vi.spyOn(provider, 'candidate').mockRejectedValueOnce(Error('unfinished'));
  const service = new VisualCreationService(store, async () => provider, assets);
  const input = { description: 'character', mode: 'text' as const };
  await expect(service.generate('c', input)).rejects.toThrow('unfinished');
  await expect(service.generate('c', input, { regenerate: true })).rejects.toThrow('尚未完成');
  expect((await service.generate('c', input)).candidates).toHaveLength(3);
});
it('resumes legacy received image results with the old cache key and no model re-planning', async () => {
  const { store, assets } = await setup();
  const planner = vi.fn(async () => undefined);
  const http = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ data: [{ url: 'https://cdn.example/legacy', size: '1024x1024' }] }),
      ),
  );
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'key',
    store,
    assets,
    hash,
    http,
    planner,
  );
  const input = { description: 'legacy paid character', mode: 'text' as const };
  const download = vi.spyOn(assets, 'download');
  download.mockRejectedValueOnce(Error('CDN failed'));
  await expect(provider.candidate(input, 0)).rejects.toThrow('CDN failed');
  await store.put('visualDrafts', {
    id: 'c',
    characterId: 'c',
    createdAt: 1,
    providerId: provider.identity,
    input,
    candidates: [],
  });
  const draft = await new VisualCreationService(store, async () => provider, assets).generate(
    'c',
    input,
  );
  expect(draft.candidates).toHaveLength(3);
  expect(planner).not.toHaveBeenCalled();
  expect(http).toHaveBeenCalledTimes(3);
});
it('falls back to the literal image request if chat planning is unavailable or uncertain', async () => {
  const { planVisualBrief } = await import('../src/appearance/brief');
  expect(
    await planVisualBrief('自定义角色', async () => {
      throw Error('no chat key');
    }),
  ).toBeUndefined();
});
it('does not let a confident text model invent canonical hair or accessories', async () => {
  const { groundedVisualBrief } = await import('../src/appearance/brief');
  const brief = groundedVisualBrief('Q版原神纳西妲，绿色眼睛，白绿服装', {
    subject: '原神 纳西妲',
    namedCharacter: true,
    style: 'Q版',
    confidence: 0.99,
    recognizableFeatures: ['绿色眼睛', '浅绿双丸子头', '皇冠', '白绿服装'],
  });
  expect(brief?.recognizableFeatures).toEqual(['绿色眼睛', '白绿服装']);
  expect(
    groundedVisualBrief('自定义角色', {
      subject: '小舟',
      namedCharacter: true,
      style: '',
      confidence: 0.99,
      recognizableFeatures: [],
    }),
  ).toBeUndefined();
});

it('uses decoded normalized dimensions and PNG bytes for decomposition and stops invalid input before billing', async () => {
  const { store, assets } = await setup();
  const prepared = vi.fn(async () => ({
    dataUrl: 'data:image/png;base64,AAAA',
    width: 1024,
    height: 1024,
  }));
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    expect(JSON.parse(String(init?.body)).image).toBe('data:image/png;base64,AAAA');
    return new Response(JSON.stringify({ error: { code: 'InvalidParameter', param: 'image' } }), {
      status: 400,
    });
  });
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'test-key',
    store,
    { ...assets, prepareDecomposition: prepared },
    hash,
    request,
  );
  // Stale asset metadata cannot override the decoded image dimensions.
  await expect(provider.split({ uri: 'file://jpeg', width: 1, height: 1 })).rejects.toThrow(
    'HTTP 400',
  );
  expect(request).toHaveBeenCalledOnce();
  prepared.mockResolvedValueOnce({
    dataUrl: 'data:image/png;base64,AAAA',
    width: 100,
    height: 100,
  });
  await expect(provider.split({ uri: 'file://small', width: 2048, height: 2048 })).rejects.toThrow(
    '至少26万',
  );
  prepared.mockResolvedValueOnce({
    dataUrl: 'data:image/png;base64,AAAA',
    width: 17000,
    height: 512,
  });
  await expect(provider.split({ uri: 'file://wide', width: 2048, height: 2048 })).rejects.toThrow(
    '宽高比',
  );
  prepared.mockResolvedValueOnce({
    dataUrl: 'data:image/png;base64,not valid',
    width: 1024,
    height: 1024,
  });
  await expect(
    provider.split({ uri: 'file://invalid', width: 2048, height: 2048 }),
  ).rejects.toThrow('编码无效');
  expect(request).toHaveBeenCalledOnce();
});
it('repairs complete arms independently, keeps other layers and reuses paid responses after download failure', async () => {
  const { store, assets } = await setup();
  const data = [
    { url: 'https://cdn.example/base', size: '1024x1024', z_index: 0 },
    ...['left_arm', 'right_arm'].map((name, i) => ({
      url: `https://cdn.example/${name}`,
      name,
      size: '256x512',
      z_index: i + 1,
      bounding_box: { normalized: [i ? 650 : 100, 400, i ? 900 : 350, 900] },
    })),
  ];
  const http = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data })));
  const prepare = vi.fn(async () => ({
    dataUrl: 'data:image/png;base64,AAAA',
    width: 1024,
    height: 1024,
  }));
  assets.prepareDecomposition = prepare;
  const download = vi
    .spyOn(assets, 'download')
    .mockRejectedValueOnce(Error('download offline'))
    .mockImplementation(async (_u, key) => ({ uri: `file://${key}`, width: 256, height: 512 }));
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'secret',
    store,
    assets,
    hash,
    http,
  );
  const rig = mockRig('x');
  rig.source = 'seedream';
  const image = { uri: 'file://selected.jpg', width: 1024, height: 1024 };
  await expect(provider.repairArms(image, rig)).rejects.toThrow('offline');
  const next = await provider.repairArms(image, rig);
  expect(next.layers.filter((l) => l.role === 'arm')).toHaveLength(2);
  expect(next.layers.filter((l) => l.role !== 'arm')).toEqual(
    rig.layers.filter((l) => l.role !== 'arm'),
  );
  expect(http).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalled();
  expect(download).toHaveBeenCalled();
  expect(JSON.parse(String(http.mock.calls[0][1]?.body))).toMatchObject({
    image: 'data:image/png;base64,AAAA',
    layer_decomposition: true,
  });
});
it('retains an invalid paid arm response without charging again or replacing the current rig', async () => {
  const { store, assets } = await setup();
  const http = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          data: [
            { url: 'https://cdn.example/base', size: '1024x1024', z_index: 0 },
            {
              url: 'https://cdn.example/arms',
              name: 'arms',
              size: '512x512',
              z_index: 1,
              bounding_box: { normalized: [100, 400, 900, 900] },
            },
          ],
        }),
      ),
  );
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'secret',
    store,
    assets,
    hash,
    http,
  );
  const rig = mockRig('x');
  rig.source = 'seedream';
  for (let i = 0; i < 2; i++)
    await expect(
      provider.repairArms({ uri: 'file://ref', width: 1024, height: 1024 }, rig),
    ).rejects.toThrow('独立双臂');
  expect(http).toHaveBeenCalledTimes(1);
  expect((await store.list('imageRequests'))[0].status).toBe('received');
});
it('does not charge twice when repairing the same selected arms', async () => {
  const { store, assets } = await setup();
  const mock = new MockImageProvider();
  const repairArms = vi.fn(async (_i: unknown, rig: ReturnType<typeof mockRig>) => rig);
  const provider = {
    identity: mock.identity,
    candidate: mock.candidate.bind(mock),
    split: mock.split.bind(mock),
    repairArms,
  };
  const service = new VisualCreationService(store, async () => provider, assets);
  await service.generate('c', { description: 'x', mode: 'text' });
  await service.select('c', 0);
  await service.repairArms('c');
  await service.repairArms('c');
  expect(repairArms).toHaveBeenCalledTimes(1);
  await service.select('c', 1);
  await service.repairArms('c');
  expect(repairArms).toHaveBeenCalledTimes(2);
});
it('corrects mislabeled backgrounds when selecting an old cached split in the same session', async () => {
  const { store, assets } = await setup();
  const mock = new MockImageProvider();
  const receipt = 'c'.repeat(64);
  await store.put('imageRequests', {
    id: receipt,
    createdAt: 1,
    status: 'done',
    response: { data: [{ name: 'base background' }] },
  });
  const provider = {
    identity: mock.identity,
    candidate: mock.candidate.bind(mock),
    split: async () => {
      const rig = mockRig('x');
      rig.source = 'seedream';
      rig.layers.push({
        ...rig.layers[0],
        role: 'detail',
        asset: { uri: `file:///images/${receipt}-0.png`, width: 100, height: 100 },
      });
      return rig;
    },
  };
  const service = new VisualCreationService(store, async () => provider, assets);
  await service.generate('c', { description: 'x', mode: 'text' });
  const rig = await service.select('c', 0);
  expect(rig.layers.at(-1)?.role).toBe('background');
});
it('persists real partial layer progress on interruption and never saves an incomplete rig', async () => {
  const { store, assets } = await setup();
  const provider = new MockImageProvider();
  const service = new VisualCreationService(store, async () => provider, assets);
  await service.generate('c', { description: 'x', mode: 'text' });
  const partial = mockRig('x');
  const split = vi
    .spyOn(provider, 'split')
    .mockImplementationOnce(
      async (
        image,
        progress?: (p: import('../src/appearance/model').VisualBuildProgress) => Promise<void>,
      ) => {
        await progress?.({
          stage: 'layers',
          source: image,
          completed: 1,
          total: 6,
          preview: { ...partial, layers: partial.layers.slice(0, 1) },
        });
        throw Error('download offline');
      },
    );
  const events: string[] = [];
  await expect(service.select('c', 0, (p) => events.push(p.stage))).rejects.toThrow('offline');
  expect(events).toEqual(['layers', 'layers', 'failed']);
  expect((await store.get('visualDrafts', 'c'))?.build).toMatchObject({
    stage: 'failed',
    failedStage: 'layers',
    completed: 1,
    total: 6,
  });
  expect((await store.get('characters', 'c'))?.rig).toBeUndefined();
  await service.select('c', undefined, (p) => events.push(p.stage));
  expect(events.at(-1)).toBe('ready');
  expect(split).toHaveBeenCalledTimes(2);
});
it('automatically repairs combined arms once, then performs local face repair without a second paid repair on resume', async () => {
  const { store, assets } = await setup();
  const mock = new MockImageProvider();
  const base = mockRig('x');
  base.source = 'seedream';
  base.layers = base.layers.filter((l) => l.role !== 'arm');
  base.layers.push({
    role: 'arm',
    z: 2,
    bounds: [0.2, 0.5, 0.6, 0.3],
    asset: { uri: 'file://combined', width: 600, height: 300 },
  });
  const repairArms = vi.fn(async () => ({
    ...base,
    layers: [
      ...base.layers.filter((l) => l.role !== 'arm'),
      ...['left', 'right'].map((uri, i) => ({
        role: 'arm' as const,
        z: 2,
        bounds: [i ? 0.7 : 0.2, 0.5, 0.1, 0.3] as [number, number, number, number],
        asset: { uri: `file://${uri}`, width: 100, height: 300 },
      })),
    ],
  }));
  const refine = vi.fn(async (_source: unknown, rig: typeof base) => rig);
  assets.refineRig = refine;
  const provider = {
    identity: mock.identity,
    candidate: mock.candidate.bind(mock),
    split: vi.fn(async () => base),
    repairArms,
  };
  const service = new VisualCreationService(store, async () => provider, assets);
  await service.generate('c', { description: 'x', mode: 'text' });
  const stages: string[] = [];
  await service.select('c', 0, (p) => stages.push(p.stage));
  expect(stages).toEqual(['layers', 'checking', 'repairing_arms', 'finishing', 'ready']);
  expect((await store.get('visualDrafts', 'c'))?.armRepairApplied).toBe(true);
  await service.select('c', 0);
  expect(repairArms).toHaveBeenCalledOnce();
  expect(refine).toHaveBeenCalledTimes(2);
});
it('keeps an unsuccessful automatic repair bounded and exposes it without losing the successful split', async () => {
  const { store, assets } = await setup();
  const mock = new MockImageProvider();
  const rig = mockRig('x');
  rig.source = 'seedream';
  rig.layers = rig.layers.filter((l) => l.role !== 'arm');
  const repairArms = vi.fn(async () => {
    throw Error('400 image');
  });
  const provider = {
    identity: mock.identity,
    candidate: mock.candidate.bind(mock),
    split: async () => rig,
    repairArms,
  };
  const service = new VisualCreationService(store, async () => provider, assets);
  await service.generate('c', { description: 'x', mode: 'text' });
  await service.select('c', 0);
  await service.select('c', 0);
  expect(repairArms).toHaveBeenCalledOnce();
  expect((await store.get('visualDrafts', 'c'))?.advisories).toContain('repair_unavailable');
});
it('does not overwrite an in-flight visual draft when restoring an existing look', async () => {
  const { store, assets } = await setup();
  const mock = new MockImageProvider();
  const service = new VisualCreationService(store, async () => mock, assets);
  await service.generate('c', { description: 'x', mode: 'text' });
  await service.select('c', 0);
  const refine = vi.fn(async (_image: unknown, rig: ReturnType<typeof mockRig>) => rig);
  assets.refineRig = refine;
  await store.lease('visual:c', Date.now(), 100000);
  await service.restoreLook('c');
  expect(refine).not.toHaveBeenCalled();
  await store.release('visual:c');
  await service.restoreLook('c');
  expect(refine).toHaveBeenCalledOnce();
});
