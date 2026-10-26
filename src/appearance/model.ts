import type { MeshAvatar } from '../avatar/model';
import { z } from 'zod';
export const ImageAssetSchema = z
  .object({
    uri: z.string().min(1).max(200000),
    width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192),
    // Inline SVG is restricted to our deterministic Mock renderer, never provider output.
    svg: z.string().max(30000).optional(),
  })
  .strict();
export type ImageAsset = z.infer<typeof ImageAssetSchema>;
export const RigSchema = z
  .object({
    version: z.literal(1),
    source: z.enum(['mock', 'seedream']),
    width: z.number().positive().max(8192),
    height: z.number().positive().max(8192),
    layers: z
      .array(
        z
          .object({
            role: z.enum(['background', 'body', 'head', 'hair', 'arm', 'eyes', 'mouth', 'detail']),
            asset: ImageAssetSchema,
            bounds: z.tuple([
              z.number().min(0).max(1),
              z.number().min(0).max(1),
              z.number().positive().max(1),
              z.number().positive().max(1),
            ]),
            z: z.number().int().min(0).max(100),
          })
          .strict(),
      )
      .min(3)
      .max(32),
  })
  .strict();
export type CharacterRig = z.infer<typeof RigSchema>;
export type CreationMode = 'text' | 'reference' | 'animate';
export interface VisualInput {
  description: string;
  mode: CreationMode;
  reference?: ImageAsset;
}
export interface ImageSettings {
  id: 'images';
  provider: 'mock' | 'seedream';
  baseUrl: string;
  imageModel: string;
  layerModel: string;
}
export const defaultImageSettings: ImageSettings = {
  id: 'images',
  provider: 'mock',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  imageModel: 'doubao-seedream-5-0-pro-260628',
  layerModel: 'doubao-seedream-5-0-pro-260628',
};
export interface VisualDraft {
  id: string;
  characterId: string;
  createdAt: number;
  providerId: string;
  input: VisualInput;
  candidates: ImageAsset[];
  selected?: ImageAsset;
  rig?: CharacterRig;
  meshAvatar?: MeshAvatar;
  saved?: boolean;
  bodyRepairApplied?: boolean;
}
export interface ImageRequestCache {
  id: string;
  createdAt: number;
  status: 'started' | 'received' | 'done';
  response?: unknown;
  result?: ImageAsset | CharacterRig;
}
export function validateRig(input: unknown): CharacterRig {
  const rig = RigSchema.parse(input);
  for (const role of ['body', 'head', 'eyes', 'mouth'])
    if (!rig.layers.some((l) => l.role === role))
      throw new Error(`拆层缺少 ${role}，尚不能生成面部动作；请调整参考图或拆层模型后重试`);
  for (const layer of rig.layers) {
    const [x, y, w, h] = layer.bounds;
    if (x + w > 1.002 || y + h > 1.002) throw new Error('图层位置超出画布');
    if (
      layer.asset.svg &&
      /<(?!\/?(?:svg|g|path|ellipse|circle|rect|polygon|line)\b)|(?:href|url\s*\(|on\w+\s*=)/i.test(
        layer.asset.svg,
      )
    )
      throw new Error('不支持的矢量图层');
  }
  return rig;
}
