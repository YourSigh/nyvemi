import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'react-native';
import { id } from '../domain/models';
import { imageHash } from '../appearance/native';
import { imageSecrets } from '../appearance/secrets';
import type { Storage } from '../storage/store';
import { MediaAssetSchema, type MediaAsset } from './model';
export const visionSecret = imageSecrets({
  get: () => SecureStore.getItemAsync('nyvemi.vision.api-key'),
  set: (key) =>
    SecureStore.setItemAsync('nyvemi.vision.api-key', key, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  remove: () => SecureStore.deleteItemAsync('nyvemi.vision.api-key'),
});
const directory = () => {
  const dir = new Directory(Paths.document, 'chat-images');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
};
export async function saveChatImage(
  store: Storage,
  cid: string,
  uri: string,
  origin: MediaAsset['origin'] = 'upload',
): Promise<MediaAsset> {
  const source = new File(uri);
  if (!source.exists || source.size > 6 * 1024 * 1024) throw Error('请选择小于6 MB的图片');
  const bytes = await source.bytes();
  const mime =
    bytes[0] === 137 && bytes[1] === 80
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216
        ? 'image/jpeg'
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
          ? 'image/webp'
          : undefined;
  if (!mime) throw Error('只支持PNG、JPEG和WebP图片');
  const { width, height } = await Image.getSize(uri),
    fingerprint = await imageHash(await source.base64());
  const existing = (await store.list('mediaAssets', cid, 10000)).find(
    (a) => a.fingerprint === fingerprint,
  );
  if (existing && new File(existing.uri).exists) return existing;
  const assetId = id(),
    target = new File(directory(), `${assetId}.bin`);
  source.copy(target);
  try {
    const asset = MediaAssetSchema.parse({
      id: assetId,
      characterId: cid,
      createdAt: Date.now(),
      uri: target.uri,
      width,
      height,
      mime,
      fingerprint,
      origin,
    });
    if (!(await store.get('characters', cid))) throw Error('角色不存在');
    await store.put('mediaAssets', asset);
    return asset;
  } catch (e) {
    if (target.exists) target.delete();
    throw e;
  }
}
export async function pickChatImages(store: Storage, cid: string, limit: number) {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 0.75,
  });
  if (picked.canceled) return [];
  const assets: MediaAsset[] = [];
  for (const item of picked.assets.slice(0, limit))
    assets.push(await saveChatImage(store, cid, item.uri));
  return assets;
}
export const mediaFiles = {
  dataUrl: async (asset: MediaAsset) => {
    const file = new File(asset.uri);
    if (!file.exists || file.size > 6 * 1024 * 1024) throw Error('图片文件缺失或过大');
    return `data:${asset.mime};base64,${await file.base64()}`;
  },
  remove: async (uri: string) => {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
};
