import { z } from 'zod';
export const MeshAvatarSchema = z
  .object({
    format: z.literal('p2lrt'),
    version: z.literal(1),
    uri: z.string().min(1).max(2000),
  })
  .strict();
export type MeshAvatar = z.infer<typeof MeshAvatarSchema>;
export function validateP2lrt(bytes: Uint8Array) {
  if (bytes.length < 32 || bytes.length > 48 * 1024 * 1024)
    throw new Error('网格模型须在 48 MB 以内');
  if (String.fromCharCode(...bytes.slice(0, 5)) !== 'P2LRT')
    throw new Error('请选择 PSD2Live 导出的 .p2lrt 模型');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  if (version !== 1 && (version & 65535) !== 2) throw new Error('不支持的网格模型版本');
  if (version === 1) return;
  const count = view.getUint32(16, true),
    table = view.getUint32(20, true);
  if (count < 7 || count > 128 || table < 32 || table + count * 40 > bytes.length)
    throw new Error('网格模型目录损坏');
  const tags = new Set<string>(),
    ranges: [number, number][] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const at = table + i * 40,
      tag = String.fromCharCode(...bytes.slice(at, at + 4));
    const offset = Number(view.getBigUint64(at + 8, true)),
      length = Number(view.getBigUint64(at + 16, true)),
      raw = Number(view.getBigUint64(at + 24, true));
    if (
      tags.has(tag) ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < table + count * 40 ||
      offset % 16 !== 0 ||
      length < 1 ||
      offset + length > bytes.length ||
      raw < 1 ||
      raw > 128 * 1024 * 1024
    )
      throw new Error('网格模型数据范围无效');
    total += raw;
    if (total > 256 * 1024 * 1024) throw new Error('网格模型解压后过大');
    tags.add(tag);
    ranges.push([offset, offset + length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((r, i) => i > 0 && r[0] < ranges[i - 1][1])) throw new Error('网格模型区块重叠');
  if (['STRS', 'CANV', 'PARM', 'DEFM', 'PART', 'MESH', 'DRAW'].some((t) => !tags.has(t)))
    throw new Error('网格模型缺少必要区块');
}
