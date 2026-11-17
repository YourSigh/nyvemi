import { Directory, File, Paths } from 'expo-file-system';
import { bridge, type LocalVoiceState } from '../native/android';
import { id } from '../domain/models';
import { assertReferenceWav } from './reference-transport';

const unsupported: LocalVoiceState = {
  available: false,
  enabled: false,
  detail: '此版本尚不支持本机模型，请安装支持本机换声的版本。',
};
export async function localVoiceState(): Promise<LocalVoiceState> {
  const native = bridge();
  // Older installed native builds do not implement this optional feature.
  return typeof native.localVoiceState === 'function' ? native.localVoiceState() : unsupported;
}
export async function importLocalVoicePack(uri: string): Promise<LocalVoiceState> {
  const native = bridge();
  if (typeof native.importLocalVoicePack !== 'function') throw Error(unsupported.detail);
  return native.importLocalVoicePack(uri);
}
export async function setLocalVoiceEnabled(enabled: boolean): Promise<LocalVoiceState> {
  const native = bridge();
  if (typeof native.setLocalVoiceEnabled !== 'function') throw Error(unsupported.detail);
  return native.setLocalVoiceEnabled(enabled);
}

export const localVoiceConversion = {
  state: localVoiceState,
  async convert(source: Uint8Array, reference: Uint8Array, signal: AbortSignal) {
    if (signal.aborted) throw Error('已取消');
    assertReferenceWav(source, 30);
    assertReferenceWav(reference, 30);
    const dir = new Directory(Paths.cache, 'local-voice-input');
    dir.create({ idempotent: true, intermediates: true });
    const sourceFile = new File(dir, `${id()}-source.wav`);
    const referenceFile = new File(dir, `${id()}-reference.wav`);
    let output: File | undefined;
    try {
      sourceFile.write(source);
      referenceFile.write(reference);
      if (signal.aborted) throw Error('已取消');
      const uri = await bridge().convertLocalVoice(sourceFile.uri, referenceFile.uri);
      const cachePrefix = Paths.cache.uri.replace(/\/$/, '') + '/';
      if (!uri.startsWith(cachePrefix) || /(?:^|\/)\.\.(?:\/|$)|%2e|%2f/i.test(uri))
        throw Error('本机换声返回了无效音频路径');
      output = new File(uri);
      if (signal.aborted) throw Error('已取消');
      if (!output.exists || !output.size || output.size > 3 * 1024 * 1024)
        throw Error('本机换声音频无效');
      const bytes = await output.bytes();
      if (signal.aborted) throw Error('已取消');
      assertReferenceWav(bytes, 30);
      return bytes;
    } finally {
      for (const file of [sourceFile, referenceFile, output]) {
        try {
          if (file?.exists) file.delete();
        } catch {
          // Only private cache files; stale cache can be cleared by the OS.
        }
      }
    }
  },
  async cancel() {
    const native = bridge();
    if (typeof native.cancelLocalVoice === 'function') await native.cancelLocalVoice();
  },
};

export async function prepareBundledLocalVoice(): Promise<LocalVoiceState> {
  const native = bridge();
  if (typeof native.prepareBundledLocalVoice !== 'function')
    throw Error('此版本未附带本机模型，请导入已校验的模型 ZIP。');
  return native.prepareBundledLocalVoice();
}
