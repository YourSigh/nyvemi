import { z } from 'zod';
export const MediaAssetSchema = z
  .object({
    id: z.string(),
    characterId: z.string(),
    createdAt: z.number(),
    uri: z.string().max(2048),
    fingerprint: z.string().min(1).max(128),
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    width: z.number().positive().max(8192),
    height: z.number().positive().max(8192),
    origin: z.enum(['upload', 'generated']),
  })
  .strict();
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
export const MediaSettingsSchema = z
  .object({
    id: z.literal('media'),
    // Missing on 0.14.0 records: preserve an explicitly configured visual endpoint.
    visionSource: z.enum(['chat', 'custom']).default('custom'),
    visionBaseUrl: z.string().url(),
    visionModel: z.string().trim().min(1).max(150),
    reuseImageKey: z.boolean(),
    drawingEnabled: z.boolean(),
    autonomousDrawing: z.boolean(),
  })
  .strict();
export type MediaSettings = z.infer<typeof MediaSettingsSchema>;
export const defaultMediaSettings: MediaSettings = {
  id: 'media',
  visionSource: 'chat',
  visionBaseUrl: 'https://api.deepseek.com',
  visionModel: 'deepseek-flash',
  reuseImageKey: false,
  drawingEnabled: false,
  autonomousDrawing: false,
};
export interface ImageAnalysis {
  id: string;
  characterId: string;
  createdAt: number;
  assetId: string;
  config: string;
  question: string;
  text: string;
}
export interface MediaFiles {
  dataUrl(asset: MediaAsset): Promise<string>;
  remove(uri: string): Promise<void>;
}

export interface MediaDrawRequest {
  id: string;
  characterId: string;
  createdAt: number;
  status: 'started' | 'done' | 'uncertain';
  assetId?: string;
}
