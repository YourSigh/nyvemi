import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  defaultImageSettings,
  SEEDREAM_PRO,
  SEEDREAM_FLASH,
  type ImageSettings,
} from '../src/appearance/model';
import { upgradeImageSettings, qualityImageSettings } from '../src/appearance/settings';
import { SeedreamImageProvider, layerBounds } from '../src/appearance/seedream';
import { VisualCreationService, type ImageAssets } from '../src/appearance/service';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';
import { demoPersona } from './persona-fixture';
const hash = async (s: string) => createHash('sha256').update(s).digest('hex');
const reference = { uri: 'file://reference', width: 1024, height: 1024 };
const input = { description: '原创蓝发角色', mode: 'text' as const };
async function fixture() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const assets: ImageAssets = {
    fingerprint: async (a) => a.uri,
    dataUrl: async () => 'data:image/png;base64,AAAA',
    exists: async () => true,
    download: vi.fn(async (_url, key) => ({ ...reference, uri: `file://${key}` })),
  };
  const requests: Record<string, unknown>[] = [];
  const http = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    return new Response(
      JSON.stringify({
        data: body.layer_decomposition
          ? [
              { url: 'https://cdn.example/base', size: '1024x1024', z_index: 0 },
              ...['body', 'head', 'eyes', 'mouth', 'left_arm', 'right_arm'].map((name, i) => ({
                name,
                url: `https://cdn.example/${name}`,
                size: '512x512',
                z_index: i + 1,
                bounding_box: { normalized: [0, 0, 1000, 1000] },
              })),
            ]
          : [{ url: 'https://cdn.example/candidate', size: '1024x1024' }],
      }),
    );
  });
  const provider = (config: ImageSettings) =>
    new SeedreamImageProvider(config, async () => 'test-secret', store, assets, hash, http);
  return { store, assets, requests, http, provider };
}
it('defaults to Pro drawing / Flash layering, upgrades only unmarked old official defaults and preserves explicit custom choices', () => {
  expect(defaultImageSettings).toMatchObject({
    imageModel: SEEDREAM_PRO,
    layerModel: SEEDREAM_FLASH,
  });
  const legacy = { ...qualityImageSettings, routingVersion: undefined };
  expect(upgradeImageSettings(legacy)).toMatchObject({
    layerModel: SEEDREAM_FLASH,
    routingVersion: 1,
  });
  expect(upgradeImageSettings(qualityImageSettings)).toBe(qualityImageSettings);
  for (const custom of [
    { ...legacy, baseUrl: 'https://custom.example/v1' },
    { ...legacy, imageModel: 'ep-custom' },
    { ...legacy, layerModel: 'ep-split' },
  ])
    expect(upgradeImageSettings(custom)).toBe(custom);
});
it('sends candidates to Pro and decomposition/body repairs to Flash', async () => {
  const { provider, requests } = await fixture();
  const p = provider(defaultImageSettings);
  await p.candidate(input, 0);
  const rig = await p.split(reference);
  await p.repairBody(reference, rig);
  expect(requests.map((r) => [r.model, !!r.layer_decomposition])).toEqual([
    [SEEDREAM_PRO, false],
    [SEEDREAM_FLASH, true],
    [SEEDREAM_FLASH, true],
  ]);
});
it('changing only the layer model reuses drawing; changing only the drawing model reuses decomposition', async () => {
  const { provider, http } = await fixture();
  const first = await provider(qualityImageSettings).candidate(input, 0);
  const second = await provider(defaultImageSettings).candidate(input, 0);
  expect(second).toEqual(first);
  expect(http).toHaveBeenCalledTimes(1);
  const rig = await provider(defaultImageSettings).split(reference);
  expect(
    await provider({ ...defaultImageSettings, imageModel: 'other-drawing-model' }).split(reference),
  ).toEqual(rig);
  expect(http).toHaveBeenCalledTimes(2);
});
it('migrates legacy received receipts with their original download names instead of paying again', async () => {
  const { provider, assets, store, http } = await fixture();
  const old = provider(qualityImageSettings),
    next = provider(defaultImageSettings);
  const legacyId = await hash(
    JSON.stringify([old.identity, 'candidate', [input.description, undefined, 0]]),
  );
  await store.put('imageRequests', {
    id: legacyId,
    createdAt: 1,
    status: 'received',
    response: { data: [{ url: 'https://cdn.example/already-paid', size: '1024x1024' }] },
  });
  next.adoptLegacyIdentity(old.identity);
  await next.candidate(input, 0);
  expect(assets.download).toHaveBeenCalledWith('https://cdn.example/already-paid', legacyId);
  expect(http).not.toHaveBeenCalled();
  expect(
    (await store.list('imageRequests')).some(
      (r) => r.migratedFrom === legacyId && r.status === 'done',
    ),
  ).toBe(true);
});
it('changing the layer model cannot bypass an ambiguous legacy paid image request', async () => {
  const { provider, store, http } = await fixture();
  const old = provider(qualityImageSettings),
    next = provider(defaultImageSettings);
  const legacyId = await hash(
    JSON.stringify([old.identity, 'candidate', [input.description, undefined, 0]]),
  );
  await store.put('imageRequests', { id: legacyId, createdAt: 1, status: 'started' });
  next.adoptLegacyIdentity(old.identity);
  await expect(next.candidate(input, 0)).rejects.toThrow('结果不确定');
  expect(http).not.toHaveBeenCalled();
});
it('keeps the candidate batch across layer switches and independently records the actual layer provider', async () => {
  const { provider, store, assets, http, requests } = await fixture();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    createdAt: 1,
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  });
  let active = provider(qualityImageSettings);
  const service = new VisualCreationService(store, async () => active, assets);
  const original = await service.generate('c', input);
  const oldId = original.providerId;
  await service.select('c', 0);
  active = provider(defaultImageSettings);
  const continued = await service.generate('c', input);
  expect(continued.candidates).toEqual(original.candidates);
  expect(http).toHaveBeenCalledTimes(4);
  await service.select('c', 0);
  expect(requests[4].model).toBe(SEEDREAM_FLASH);
  expect(await store.get('visualDrafts', 'c')).toMatchObject({
    providerId: oldId,
    layerProviderId: active.identity,
  });
  active = provider({ ...defaultImageSettings, imageModel: 'another-image-model' });
  await service.select('c', 0);
  expect(http).toHaveBeenCalledTimes(5);
});
it('resumes a partly downloaded batch across a layer switch without repeating the image POST', async () => {
  const { provider, store, assets, http } = await fixture();
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    interests: [],
    createdAt: 1,
    state: { energy: 0.5, relationshipCloseness: 0, recentFocus: [], curiosityTopics: [] },
  });
  const originalDownload = vi.mocked(assets.download).getMockImplementation()!;
  vi.mocked(assets.download)
    .mockImplementationOnce(originalDownload)
    .mockRejectedValueOnce(Error('download interrupted'));
  let active = provider(qualityImageSettings);
  const service = new VisualCreationService(store, async () => active, assets);
  await expect(service.generate('c', input)).rejects.toThrow('interrupted');
  expect(http).toHaveBeenCalledTimes(2);
  active = provider(defaultImageSettings);
  expect((await service.generate('c', input)).candidates).toHaveLength(3);
  expect(http).toHaveBeenCalledTimes(3);
});

it('prefers native pixel layer placement and rejects malformed bounds without guessing', () => {
  expect(
    layerBounds({ normalized: [309, 432, 693, 964], absolute: [633, 885, 1420, 1975] }, 2048, 2048),
  ).toEqual([633 / 2048, 885 / 2048, 787 / 2048, 1090 / 2048]);
  expect(layerBounds({ normalized: [0, 100, 1000, 900] }, 2048, 2048)).toEqual([0, 0.1, 1, 0.8]);
  for (const absolute of [
    [0, 0, 2049, 2048],
    [10, 0, 5, 100],
    [0, -1, 10, 100],
    [0, 0, NaN, 100],
  ] as [number, number, number, number][])
    expect(() => layerBounds({ normalized: [0, 0, 1000, 1000], absolute }, 2048, 2048)).toThrow(
      '图层坐标无效',
    );
});
