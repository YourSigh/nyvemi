import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { id, VoiceReferenceSchema, type VoiceReference } from '../domain/models';
import { bridge } from '../native/android';
import { assertReferenceWav } from './reference-transport';

export type VoiceCompanionConfig = { baseUrl: string; token: string };
const connectionKey = 'nyvemi.voice-companion.connection';
const maximumWav = 3 * 1024 * 1024;
const hasWavHeader = (data: Uint8Array) =>
  data.length >= 44 &&
  data.length <= maximumWav &&
  String.fromCharCode(...data.subarray(0, 4)) === 'RIFF' &&
  String.fromCharCode(...data.subarray(8, 12)) === 'WAVE';

export function normalizeVoiceCompanion(
  baseUrl: string,
  token: string,
  development = __DEV__,
): VoiceCompanionConfig {
  const input = baseUrl.trim();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw Error('请输入换声服务的完整 HTTPS 地址');
  }
  const loopback = development && url.origin === 'http://127.0.0.1:4319';
  if (
    (!loopback && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw Error('请用不含路径或凭据的 HTTPS 地址；调试仅支持 127.0.0.1:4319');
  const key = token.trim();
  if (/^sk[-_]/i.test(key) || !/^[A-Za-z0-9._~-]{32,256}$/.test(key))
    throw Error('请输入换声服务的独立访问令牌，不要填写 DeepSeek Key');
  return { baseUrl: url.origin, token: key };
}

export async function getVoiceCompanion(): Promise<VoiceCompanionConfig | null> {
  const saved = await SecureStore.getItemAsync(connectionKey);
  if (!saved) return null;
  try {
    const data = JSON.parse(saved);
    return normalizeVoiceCompanion(data.baseUrl, data.token);
  } catch {
    return null;
  }
}

export async function saveVoiceCompanion(baseUrl: string, token: string) {
  const config = normalizeVoiceCompanion(baseUrl, token);
  await SecureStore.setItemAsync(connectionKey, JSON.stringify(config), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export const deleteVoiceCompanion = () => SecureStore.deleteItemAsync(connectionKey);
const directory = (cache = false) => {
  const dir = new Directory(
    cache ? Paths.cache : Paths.document,
    cache ? 'voice-playback' : 'voice-references',
  );
  dir.create({ idempotent: true, intermediates: true });
  return dir;
};

export function saveReferenceWav(bytes: Uint8Array, label: string): VoiceReference {
  if (bytes.length > maximumWav) throw Error('参考声音不能超过 3 MiB');
  assertReferenceWav(bytes, 30);
  const reference = VoiceReferenceSchema.parse({
    id: id(),
    label:
      label
        .trim()
        .replace(/[\r\n\u0000-\u001f]/g, ' ')
        .slice(0, 120) || '我的参考声',
  });
  new File(directory(), `${reference.id}.wav`).write(bytes);
  return reference;
}

export async function loadReferenceWav(referenceId: string): Promise<Uint8Array> {
  if (!/^[a-f0-9-]{36}$/.test(referenceId)) throw Error('参考录音找不到了');
  const file = new File(directory(), `${referenceId}.wav`);
  if (!file.exists || !file.size || file.size > maximumWav) throw Error('参考录音找不到了');
  const bytes = await file.bytes();
  assertReferenceWav(bytes, 30);
  return bytes;
}

export function removeReferenceWav(referenceId: string) {
  if (!/^[a-f0-9-]{36}$/.test(referenceId)) return;
  try {
    const file = new File(directory(), `${referenceId}.wav`);
    if (file.exists) file.delete();
  } catch {
    /* keeping an unused local file is safer */
  }
}

export async function playReferenceWav(idForPlayer: string, bytes: Uint8Array): Promise<boolean> {
  if (!hasWavHeader(bytes)) throw Error('换声服务返回的音频无效');
  const file = new File(directory(true), `${id()}.wav`);
  try {
    file.write(bytes);
    return await bridge().playVoiceWav(idForPlayer, file.uri);
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      /* cache is expendable */
    }
  }
}

export async function readPickedReference(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  if (!file.exists || !file.size || file.size > maximumWav)
    throw Error('请选择不超过 3 MiB、30 秒的 WAV 录音');
  const bytes = await file.bytes();
  assertReferenceWav(bytes, 30);
  return bytes;
}
