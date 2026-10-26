import { createHash } from 'node:crypto';
import { it, expect, vi } from 'vitest';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona, defaultSettings } from '../src/domain/models';
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
