import demoModel from '../../assets/avatar/tongza.p2lrt';
import playerAsset from '../../vendor/psd2live-runtime/player.txt';
import driverAsset from '../../assets/avatar/driver.txt';
import wasmAsset from '../../vendor/psd2live-runtime/runtime.wasm';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { id } from '../domain/models';
import type { Storage } from '../storage/store';
import { type MeshAvatar, validateP2lrt } from './model';
import { avatarHTML } from './html';
const directory = () => {
  const d = new Directory(Paths.document, 'character-images');
  d.create({ idempotent: true, intermediates: true });
  return d;
};
export async function writeMeshAvatar(cid: string, bytes: Uint8Array) {
  validateP2lrt(bytes);
  const f = new File(directory(), `mesh-${cid}-${id()}.p2lrt`);
  f.write(bytes);
  return f.uri;
}
export async function pickMeshAvatar(store: Storage, cid: string): Promise<MeshAvatar | undefined> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled) return;
  const file = new File(picked.assets[0].uri);
  if (file.size > 48 * 1024 * 1024) throw new Error('网格模型不能超过 48 MB');
  return stageMeshAvatar(store, cid, await file.bytes());
}
export async function stageMeshAvatar(
  store: Storage,
  cid: string,
  bytes: Uint8Array,
): Promise<MeshAvatar> {
  validateP2lrt(bytes);
  const lock = `visual:${cid}`;
  if (!(await store.lease(lock, Date.now(), 120000))) throw new Error('形象正在处理中');
  if (!(await store.lease('visual-assets', Date.now(), 120000))) {
    await store.release(lock);
    throw new Error('图像资源正在处理中');
  }
  let uri: string | undefined;
  try {
    const c = await store.get('characters', cid);
    if (!c) throw new Error('角色不存在');
    uri = await writeMeshAvatar(cid, bytes);
    const meshAvatar: MeshAvatar = { format: 'p2lrt', version: 1, uri };
    await store.put('visualDrafts', {
      id: cid,
      characterId: cid,
      createdAt: Date.now(),
      providerId: 'p2lrt-import',
      input: { description: c.persona.appearance || '网格角色', mode: 'animate' },
      candidates: [],
      meshAvatar,
    });
    return meshAvatar;
  } catch (error) {
    if (uri) {
      const f = new File(uri);
      if (f.exists) f.delete();
    }
    throw error;
  } finally {
    await store.release(lock);
    await store.release('visual-assets');
  }
}
async function assetFile(module: number) {
  const asset = await Asset.fromModule(module).downloadAsync();
  if (!asset.localUri) throw new Error('离线角色运行时缺失');
  return new File(asset.localUri);
}
let resources: Promise<{ player: string; driver: string; wasm: string }> | undefined;
export async function meshAvatarHTML(model: MeshAvatar) {
  resources ??= Promise.all([
    assetFile(playerAsset).then((f) => f.text()),
    assetFile(driverAsset).then((f) => f.text()),
    assetFile(wasmAsset).then((f) => f.base64()),
  ])
    .then(([player, driver, wasm]) => ({ player, driver, wasm }))
    .catch((e) => {
      resources = undefined;
      throw e;
    });
  const source = new File(model.uri);
  validateP2lrt(await source.bytes());
  const { player, driver, wasm } = await resources;
  return avatarHTML(player, driver, wasm, await source.base64());
}

export async function stageDemoMeshAvatar(store: Storage, cid: string) {
  const f = await assetFile(demoModel);
  return stageMeshAvatar(store, cid, await f.bytes());
}

export async function upgradeBuiltinMeshModels(store: Storage) {
  const { upgradeKnownModels } = await import('./upgrade');
  const { digest, CryptoDigestAlgorithm } = await import('expo-crypto');
  await upgradeKnownModels(
    store,
    {
      read: (uri) => new File(uri).bytes(),
      digest: async (bytes) =>
        Array.from(
          new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, Uint8Array.from(bytes).buffer)),
        )
          .map((v) => v.toString(16).padStart(2, '0'))
          .join(''),
      write: writeMeshAvatar,
      remove: async (uri) => {
        const f = new File(uri);
        if (f.exists) f.delete();
      },
    },
    [
      {
        length: 6161428,
        digest: '7923e164488f39b306421c14ea90a68e2bfd2164124b4c29c32d78011e448fca',
      },
      {
        length: 11432228,
        digest: '329324ea9e4a458f143e38fbfe06886f6f0f2c36d5a94bdfb6b0360cd6b6b188',
      },
      {
        length: 13194132,
        digest: 'bb83f68ce9f77e4567cde0dd5cf780a95546c4c64ba8293097a946ae65aa6345',
      },
    ],
    async () => (await assetFile(demoModel)).bytes(),
  );
}
