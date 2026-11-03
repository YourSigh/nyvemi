import { demoPersona } from './persona-fixture';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetch as nativeFetch } from 'expo/fetch';
import { imageAssets, imageHash } from '../src/appearance/native';
import { SeedreamImageProvider } from '../src/appearance/seedream';
import { defaultImageSettings } from '../src/appearance/model';
import { VisualCreationService } from '../src/appearance/service';
import { SQLiteStore, migrate } from '../src/storage/store';
import { TestDatabase } from './database';

const { AbortController: MobileController, AbortSignal: MobileSignal } = createRequire(
  import.meta.url,
)('abort-controller/dist/abort-controller');
const disk = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file://documents' },
  Directory: class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    create() {}
  },
  File: class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() {
      return disk.has(this.uri);
    }
    get size() {
      return disk.get(this.uri)?.length ?? 0;
    }
    async bytes() {
      return disk.get(this.uri)!;
    }
    async base64() {
      return Buffer.from(disk.get(this.uri)!).toString('base64');
    }
    write(value: Uint8Array) {
      disk.set(this.uri, value);
    }
    delete() {
      disk.delete(this.uri);
    }
  },
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: async (_algorithm: string, text: string) =>
    createHash('sha256').update(text).digest('hex'),
}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-image-picker', () => ({}));
vi.mock('react-native', () => ({
  Image: {
    getSize: async (uri: string) => {
      const bytes = Buffer.from(disk.get(uri)!);
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    },
  },
}));
vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));
const png = readFileSync('assets/nyvemi-icon.png');
beforeEach(() => {
  disk.clear();
  vi.mocked(nativeFetch).mockReset();
  // The exact polyfill registered by RN setUpXHR, not Node's richer Web APIs.
  vi.stubGlobal('AbortController', MobileController);
  vi.stubGlobal('AbortSignal', MobileSignal);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const successfulDownload = () =>
  new Response(png, { headers: { 'content-type': 'image/png' } }) as unknown as Awaited<
    ReturnType<typeof nativeFetch>
  >;
async function fixture() {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  await store.put('characters', {
    id: 'c',
    persona: demoPersona('c'),
    state: { energy: 0.5, relationshipCloseness: 0.3, recentFocus: [], curiosityTopics: [] },
    interests: [],
    createdAt: 1,
  });
  const paid = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          data: [{ url: 'https://cdn.example/generated.png', size: '1024x1024' }],
        }),
      ),
  );
  const provider = () =>
    new SeedreamImageProvider(
      defaultImageSettings,
      async () => 'test-only-key',
      store,
      imageAssets,
      imageHash,
      paid,
    );
  return { store, paid, provider };
}
it('downloads and validates generated images using the RN AbortSignal implementation with no static helpers', async () => {
  expect(typeof AbortSignal.timeout).toBe('undefined');
  expect(typeof AbortSignal.any).toBe('undefined');
  vi.mocked(nativeFetch).mockImplementation(async () => successfulDownload());
  const asset = await imageAssets.download('https://cdn.example/image.png', 'download');
  expect(asset.width).toBeGreaterThan(0);
  expect(await imageAssets.exists(asset)).toBe(true);
  const request = vi.mocked(nativeFetch).mock.calls[0][1]!;
  expect(request.signal).toBeInstanceOf(MobileSignal);
  expect(request.headers).toBeUndefined();
});
it('resumes a received paid candidate after a CDN failure without another generation POST', async () => {
  const f = await fixture();
  vi.mocked(nativeFetch)
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockImplementation(async () => successfulDownload());
  const input = { description: 'a simple original character', mode: 'text' as const };
  await expect(f.provider().candidate(input, 0)).rejects.toThrow();
  expect(f.paid).toHaveBeenCalledOnce();
  expect((await f.store.list('imageRequests'))[0]).toMatchObject({ status: 'received' });
  const asset = await f.provider().candidate(input, 0);
  expect(await f.provider().candidate(input, 0)).toEqual(asset);
  expect(f.paid).toHaveBeenCalledOnce();
  expect(nativeFetch).toHaveBeenCalledTimes(2);
});
it('completes all three candidates through native image assets and reuses them on retry', async () => {
  const f = await fixture();
  vi.mocked(nativeFetch).mockImplementation(async () => successfulDownload());
  const creation = new VisualCreationService(f.store, async () => f.provider(), imageAssets);
  const input = { description: 'a simple original character', mode: 'text' as const };
  const draft = await creation.generate('c', input);
  expect(draft.candidates).toHaveLength(3);
  expect(new Set(draft.candidates.map((image) => image.uri)).size).toBe(3);
  expect((await creation.generate('c', input)).candidates).toEqual(draft.candidates);
  expect(f.paid).toHaveBeenCalledTimes(3);
  expect(nativeFetch).toHaveBeenCalledTimes(3);
});
it('times out a stalled native download and releases its timer', async () => {
  vi.useFakeTimers();
  let downloadSignal: AbortSignal | undefined;
  vi.mocked(nativeFetch).mockImplementation(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        downloadSignal = init?.signal ?? undefined;
        downloadSignal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const result = imageAssets
    .download('https://cdn.example/image.png', 'slow')
    .catch((e: Error) => e.message);
  await vi.advanceTimersByTimeAsync(60001);
  expect(await result).toContain('超时');
  expect(downloadSignal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(disk.size).toBe(0);
});
it('forwards user cancellation and avoids even a CDN request when already canceled', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    imageAssets.download('https://cdn.example/image.png', 'cancel', controller.signal),
  ).rejects.toThrow('取消');
  expect(nativeFetch).not.toHaveBeenCalled();
});
it('cancels an active download and removes its parent listener and timeout', async () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  const remove = vi.spyOn(parent.signal, 'removeEventListener');
  let downloadSignal: AbortSignal | undefined;
  vi.mocked(nativeFetch).mockImplementation(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        downloadSignal = init?.signal ?? undefined;
        downloadSignal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const result = imageAssets
    .download('https://cdn.example/image.png', 'cancel-active', parent.signal)
    .catch((e: Error) => e.message);
  parent.abort();
  expect(await result).toContain('取消');
  expect(downloadSignal?.aborted).toBe(true);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});
