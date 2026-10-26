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
}
