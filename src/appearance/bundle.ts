import { z } from 'zod';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { RigSchema, validateRig, type CharacterRig } from './model';
import { isAvatar } from '../transfer/bundle';
const Manifest = z
  .object({ format: z.literal('nyvemi-look'), version: z.literal(1), rig: RigSchema })
  .strict();
const LIMIT = 100 * 1024 * 1024;
export async function exportLook(rig: CharacterRig, read: (uri: string) => Promise<Uint8Array>) {
  const portable = validateRig(rig);
  const files: Record<string, Uint8Array> = {};
  const mapped = new Map<string, string>();
  let total = 0;
  for (const l of portable.layers) {
    if (l.asset.svg) continue;
    if (!mapped.has(l.asset.uri)) {
      const bytes = await read(l.asset.uri);
      if (bytes.length > 12 * 1024 * 1024 || !isAvatar(bytes)) throw new Error('不支持的图层文件');
      total += bytes.length;
      if (total > LIMIT) throw new Error('形象文件超过 100 MB');
      const name = `${mapped.size}.bin`;
      mapped.set(l.asset.uri, name);
      files[name] = bytes;
    }
    l.asset.uri = mapped.get(l.asset.uri)!;
  }
  files['manifest.json'] = strToU8(
    JSON.stringify({ format: 'nyvemi-look', version: 1, rig: portable }),
  );
  return zipSync(files, { level: 6 });
}
export async function importLook(
  bytes: Uint8Array,
  write: (bytes: Uint8Array) => Promise<string>,
  remove: (uri: string) => Promise<void>,
): Promise<CharacterRig> {
  if (bytes.length > LIMIT) throw new Error('形象文件超过 100 MB');
  let total = 0;
  const names = new Set<string>();
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (
        (f.name !== 'manifest.json' && !/^\d{1,2}\.bin$/.test(f.name)) ||
        names.has(f.name) ||
        names.size >= 33
      )
        throw new Error('形象文件包含非法条目');
      names.add(f.name);
      total += f.originalSize;
      if (f.originalSize > 12 * 1024 * 1024 || total > LIMIT) throw new Error('形象文件过大');
      return true;
    },
  });
  if (!files['manifest.json']) throw new Error('形象文件缺少清单');
  const rig = validateRig(Manifest.parse(JSON.parse(strFromU8(files['manifest.json']))).rig);
  const referenced = new Set(rig.layers.filter((l) => !l.asset.svg).map((l) => l.asset.uri));
  if (
    [...referenced].some(
      (uri) => !/^\d{1,2}\.bin$/.test(uri) || !files[uri] || !isAvatar(files[uri]),
    )
  )
    throw new Error('图层文件缺失或不支持');
  if (Object.keys(files).some((name) => name !== 'manifest.json' && !referenced.has(name)))
    throw new Error('形象文件包含多余图层');
  const mapped = new Map<string, string>();
  try {
    for (const uri of referenced) mapped.set(uri, await write(files[uri]));
    for (const l of rig.layers) if (!l.asset.svg) l.asset.uri = mapped.get(l.asset.uri)!;
    return rig;
  } catch (error) {
    for (const uri of mapped.values()) await remove(uri).catch(() => undefined);
    throw error;
  }
}
