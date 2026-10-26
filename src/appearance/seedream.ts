import { z } from 'zod';
import type { Storage } from '../storage/store';
import {
  type CharacterRig,
  type ImageAsset,
  type ImageSettings,
  type VisualInput,
  validateRig,
} from './model';
import type { ImageAssets, ImageProvider } from './service';
import { validateImageSettings } from './service';
const Output = z.object({
  url: z.string().url(),
  size: z.string().regex(/^\d+x\d+$/),
  z_index: z.number().int().nonnegative().max(100).optional(),
  bounding_box: z
    .object({
      normalized: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      name: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
});
const ResponseSchema = z.object({ data: z.array(Output).min(1).max(17) });
export const generationPrompt = (description: string) =>
  `Create one original character reference illustration: ${description}. Front facing, full body including feet, neutral symmetrical relaxed pose, both eyes open, arms separated from torso, clear anatomy and silhouette, simple plain background. No text, no props covering face or body, no collage. Suitable for independent head, hair, limbs, eyes and mouth animation.`;
export const decompositionPrompt =
  'Decompose this character into animation-ready transparent PNG layers. Separate: body, head (face skin with eyes and mouth removed and cleanly filled), hair, arms, eyes (both open eyes), mouth. English names: body, head, hair, arm, eyes, mouth. Complete occluded anatomy, hair and face beneath removed parts. Background only in base layer; do not duplicate the character in base. Preserve original alignment and identity. Each layer contains only the named part. Do not leave eyes or mouth painted on the head layer.';
export class SeedreamImageProvider implements ImageProvider {
  identity: string;
  private config: ImageSettings;
  constructor(
    config: ImageSettings,
    private key: () => Promise<string | null>,
    private store: Storage,
    private assets: ImageAssets,
    private hash: (text: string) => Promise<string>,
    private http: typeof fetch = fetch,
  ) {
    this.config = validateImageSettings(config);
    this.identity = `${this.config.baseUrl}:${config.imageModel}:${config.layerModel}:v1`;
  }
  private async cached<T extends ImageAsset | CharacterRig>(
    operation: string,
    input: unknown,
    body: Record<string, unknown>,
    decode: (value: unknown, cacheId: string) => Promise<T>,
  ): Promise<T> {
    const cacheId = await this.hash(JSON.stringify([this.identity, operation, input]));
    const lock = `image-request:${cacheId}`;
    if (!(await this.store.lease(lock, Date.now(), 12 * 60_000)))
      throw new Error('同一图片请求正在处理中');
    try {
      let record = await this.store.get('imageRequests', cacheId);
      if (record?.status === 'done' && record.result) {
        const assets =
          'layers' in record.result ? record.result.layers.map((l) => l.asset) : [record.result];
        if (
          await Promise.all(assets.map((a) => this.assets.exists(a))).then((v) => v.every(Boolean))
        )
          return record.result as T;
      }
      if (record?.status === 'started')
        throw new Error(
          '上次付费请求结果不确定，已停止自动重试以避免重复扣费。请先在火山方舟确认请求结果',
        );
      if (!record?.response) {
        const secret = await this.key();
        if (!secret?.trim()) throw new Error('请先保存豆包 API Key');
        record = { id: cacheId, createdAt: Date.now(), status: 'started' };
        await this.store.put('imageRequests', record);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 180_000);
        try {
          const response = await this.http(`${this.config.baseUrl}/images/generations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (!response.ok) {
            // Only definitive client rejection can be retried automatically. Never log response bodies or keys.
            if ([400, 401, 403, 404, 422, 429].includes(response.status))
              await this.store.remove('imageRequests', cacheId);
            throw new Error(`生图接口返回 HTTP ${response.status}`);
          }
          const payload: unknown = await response.json();
          // Persist before validation/download: retries must not issue another paid POST.
          record = { ...record, status: 'received', response: payload };
          await this.store.put('imageRequests', record);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('生图接口返回')) throw error;
          throw new Error('生图请求中断；结果可能已计费，已保留请求状态，请先核对服务商记录');
        } finally {
          clearTimeout(timer);
        }
      }
      const result = await decode(record.response, cacheId);
      await this.store.put('imageRequests', { ...record, status: 'done', result });
      return result;
    } finally {
      await this.store.release(lock);
    }
  }
  async candidate(input: VisualInput, index: number): Promise<ImageAsset> {
    const fingerprint = input.reference
      ? await this.assets.fingerprint(input.reference)
      : undefined;
    return this.cached(
      'candidate',
      [input.description, fingerprint, index],
      {
        model: this.config.imageModel,
        prompt: generationPrompt(input.description) + ` Design variation ${index + 1}.`,
        size: '2K',
        response_format: 'url',
        watermark: false,
        ...(input.reference ? { image: await this.assets.dataUrl(input.reference) } : {}),
      },
      async (value, cacheId) => {
        const response = ResponseSchema.parse(value);
        if (response.data.length !== 1) throw new Error('单图接口返回数量异常，已缓存响应');
        const output = response.data[0];
        const asset = await this.assets.download(output.url, cacheId);
        return asset;
      },
    );
  }
  async split(image: ImageAsset): Promise<CharacterRig> {
    return this.cached(
      'split',
      await this.assets.fingerprint(image),
      {
        model: this.config.layerModel,
        image: await this.assets.dataUrl(image),
        prompt: decompositionPrompt,
        layer_decomposition: true,
        size: '2K',
        response_format: 'url',
        watermark: false,
      },
      async (value, cacheId) => {
        const response = ResponseSchema.parse(value);
        const base = response.data.find((item) => item.z_index === 0 || !item.bounding_box);
        if (!base) throw new Error('拆层返回缺少底图尺寸');
        const [width, height] = base.size.split('x').map(Number);
        const layers: CharacterRig['layers'] = [];
        for (const [i, item] of response.data.entries()) {
          // Base backgrounds are intentionally omitted: character stage must stay transparent.
          if (!item.bounding_box) continue;
          const name =
            `${item.bounding_box.name ?? ''} ${item.bounding_box.description ?? ''}`.toLowerCase();
          const role = /eye|眼/.test(name)
            ? 'eyes'
            : /mouth|嘴|口部/.test(name)
              ? 'mouth'
              : /hair|头发|发丝/.test(name)
                ? 'hair'
                : /head|face|头部|脸/.test(name)
                  ? 'head'
                  : /arm|hand|手/.test(name)
                    ? 'arm'
                    : /body|torso|身体|躯干|服装|衣/.test(name)
                      ? 'body'
                      : 'detail';
          const [left, top, right, bottom] = item.bounding_box.normalized.map((n) => n / 1000);
          layers.push({
            role,
            asset: await this.assets.download(item.url, `${cacheId}-${i}`),
            bounds: [left, top, right - left, bottom - top],
            z: item.z_index ?? i,
          });
        }
        return validateRig({ version: 1, source: 'seedream', width, height, layers });
      },
    );
  }
}
