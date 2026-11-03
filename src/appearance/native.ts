import { publicUrl } from '../agent/web';
import { id } from '../domain/models';
import { imageSecrets } from './secrets';
import { pruneVisualAssets } from './cleanup';
import type { Storage } from '../storage/store';
import { Directory, File, Paths } from 'expo-file-system';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'react-native';
import { fetch as nativeFetch } from 'expo/fetch';
import { isAvatar } from '../transfer/bundle';
import type { ImageAsset } from './model';
import type { ImageAssets } from './service';
export const imageHash = (text: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
const directory = () => {
  const dir = new Directory(Paths.document, 'character-images');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
};
export const imageSecret = imageSecrets({
  get: () => SecureStore.getItemAsync('nyvemi.images.api-key'),
  set: (key: string) =>
    SecureStore.setItemAsync('nyvemi.images.api-key', key, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  remove: () => SecureStore.deleteItemAsync('nyvemi.images.api-key'),
});
async function inspect(file: File): Promise<ImageAsset> {
  if (!file.exists || file.size > 12 * 1024 * 1024) throw new Error('请使用小于 12 MB 的图片');
  const bytes = await file.bytes();
  if (!isAvatar(bytes)) throw new Error('仅支持 PNG、JPEG、WebP 图片');
  const { width, height } = await Image.getSize(file.uri);
  if (width > 8192 || height > 8192 || width * height > 20_000_000) throw new Error('图片尺寸过大');
  return { uri: file.uri, width, height };
}
export const imageAssets: ImageAssets = {
  exists: async (asset) => Boolean(asset.svg) || new File(asset.uri).exists,
  fingerprint: async (asset) => imageHash(asset.svg ?? (await new File(asset.uri).base64())),
  dataUrl: async (asset) => {
    if (asset.svg) throw new Error('演示图片不能发送到真实生图接口');
    const file = new File(asset.uri);
    await inspect(file);
    const b = await file.bytes();
    const mime = b[0] === 137 ? 'image/png' : b[0] === 255 ? 'image/jpeg' : 'image/webp';
    return `data:${mime};base64,${await file.base64()}`;
  },
  download: async (url, key, signal) => {
    if (signal?.aborted) throw new Error('图片下载已取消，已生成结果会保留');
    let parsed: URL;
    try {
      parsed = publicUrl(url);
    } catch {
      throw new Error('图片下载地址不安全');
    }
    const target = new File(directory(), `${key}.png`);
    if (target.exists) {
      try {
        return await inspect(target);
      } catch {
        target.delete();
      }
    }
    // RN's AbortSignal polyfill has neither timeout() nor any(). Use the same
    // AbortController primitives supported by the generation transport.
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60_000);
    try {
      // No Authorization header is ever forwarded to image/CDN hosts.
      let response: Response | undefined;
      for (let redirects = 0; redirects < 4; redirects++) {
        response = await nativeFetch(parsed.href, {
          signal: controller.signal,
          redirect: 'manual',
          credentials: 'omit',
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) throw Error('图片下载地址不安全');
          try {
            parsed = publicUrl(new URL(location, parsed).href);
          } catch {
            throw Error('图片下载地址不安全');
          }
          response = undefined;
          continue;
        }
        if (response.redirected || (response.url && publicUrl(response.url).href !== parsed.href))
          throw Error('图片下载地址不安全');
        break;
      }
      if (!response) throw Error('图片下载地址不安全');
      if (!response.ok) throw new Error(`下载图片失败（${response.status}），重试不会重新生图`);
      if (Number(response.headers.get('content-length')) > 12 * 1024 * 1024)
        throw new Error('输出图片过大');
      let bytes: Uint8Array;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > 12 * 1024 * 1024) {
              await reader.cancel();
              throw Error('输出图片过大');
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
        bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
      } else bytes = new Uint8Array(await response.arrayBuffer());
      if (controller.signal.aborted) throw new Error('download_aborted');
      if (bytes.length > 12 * 1024 * 1024 || !isAvatar(bytes))
        throw new Error('输出图片格式或尺寸不支持');
      target.write(bytes);
      try {
        return await inspect(target);
      } catch (e) {
        if (target.exists) target.delete();
        throw e;
      }
    } catch (error) {
      if (signal?.aborted) throw new Error('图片下载已取消，已生成结果会保留');
      if (timedOut) throw new Error('下载图片超时，重试不会重新生图');
      if (
        error instanceof Error &&
        /^(下载图片失败|图片下载地址|输出图片|请使用小于|仅支持|图片尺寸)/.test(error.message)
      )
        throw error;
      throw new Error('下载或保存图片失败，重试会继续使用已生成结果');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  },
};
export async function pickReference(): Promise<ImageAsset | undefined> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled) return;
  const original = new File(result.assets[0].uri);
  await inspect(original);
  const key = await imageHash(await original.base64());
  const target = new File(directory(), `reference-${key}.png`);
  if (!target.exists) original.copy(target);
  return inspect(target);
}

export const cleanupVisualAssets = (store: Storage) =>
  pruneVisualAssets(store, {
    list: async () =>
      directory()
        .list()
        .filter((f): f is File => f instanceof File)
        .map((f) => f.uri),
    remove: async (uri) => {
      const f = new File(uri);
      if (f.exists) f.delete();
    },
  });

export async function importRigImage(characterId: string, bytes: Uint8Array): Promise<string> {
  const file = new File(directory(), `import-${characterId}-${id()}.png`);
  file.write(bytes);
  try {
    await inspect(file);
    return file.uri;
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
}

export async function pickLayeredLook(store: Storage, characterId: string) {
  const { getDocumentAsync } = await import('expo-document-picker');
  const { importLook } = await import('./bundle');
  const result = await getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return;
  const file = new File(result.assets[0].uri);
  if (file.size > 100 * 1024 * 1024) throw new Error('形象文件超过 100 MB');
  const lock = `visual:${characterId}`;
  if (!(await store.lease(lock, Date.now(), 45 * 60_000))) throw new Error('形象正在处理中');
  if (!(await store.lease('visual-assets', Date.now(), 45 * 60_000))) {
    await store.release(lock);
    throw new Error('图像资源正在处理中');
  }
  const written: string[] = [];
  const remove = async (uri: string) => {
    const f = new File(uri);
    if (f.exists) f.delete();
  };
  try {
    const c = await store.get('characters', characterId);
    if (!c) throw new Error('角色不存在');
    const rig = await importLook(
      await file.bytes(),
      async (bytes) => {
        const uri = await importRigImage(characterId, bytes);
        written.push(uri);
        return uri;
      },
      remove,
    );
    await store.put('visualDrafts', {
      id: characterId,
      characterId,
      createdAt: Date.now(),
      providerId: 'import',
      input: { description: c.persona.appearance || '导入形象', mode: 'animate' },
      candidates: [],
      rig,
    });
    return rig;
  } catch (error) {
    for (const uri of written) await remove(uri).catch(() => undefined);
    throw error;
  } finally {
    await store.release(lock);
    await store.release('visual-assets');
  }
}
