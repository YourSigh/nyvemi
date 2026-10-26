import { MeshAvatarSchema } from '../avatar/model';
import type { Storage } from '../storage/store';
import {
  type CharacterRig,
  type ImageAsset,
  type ImageSettings,
  type VisualInput,
  validateRig,
} from './model';
import { mockCandidate, mockRig } from './mock';
export interface ImageAssets {
  fingerprint(asset: ImageAsset): Promise<string>;
  dataUrl(asset: ImageAsset): Promise<string>;
  download(url: string, key: string): Promise<ImageAsset>;
  exists(asset: ImageAsset): Promise<boolean>;
}
export interface ImageProvider {
  identity: string;
  candidate(input: VisualInput, index: number): Promise<ImageAsset>;
  split(image: ImageAsset): Promise<CharacterRig>;
  repairBody?(image: ImageAsset, rig: CharacterRig): Promise<CharacterRig>;
}
export class MockImageProvider implements ImageProvider {
  identity = 'mock-v1';
  async candidate(input: VisualInput, index: number) {
    return mockCandidate(`${input.description}:${index}`);
  }
  async split(image: ImageAsset) {
    return mockRig(
      image.uri.startsWith('mock:preview:') ? image.uri.slice('mock:preview:'.length) : image.uri,
    );
  }
}
export class VisualCreationService {
  constructor(
    private store: Storage,
    private provider: () => Promise<ImageProvider>,
    private assets: ImageAssets,
  ) {}
  async generate(characterId: string, input: VisualInput) {
    if (!input.description.trim() || input.description.length > 2000)
      throw new Error('请用 1～2000 字描述形象');
    if (input.mode !== 'text' && !input.reference) throw new Error('请先选择参考图');
    const lock = `visual:${characterId}`;
    if (!(await this.store.lease(lock, Date.now(), 45 * 60_000)))
      throw new Error('形象正在处理中，请稍后继续');
    if (!(await this.store.lease('visual-assets', Date.now(), 45 * 60_000))) {
      await this.store.release(lock);
      throw new Error('图像资源正在处理中，请稍后继续');
    }
    try {
      if (!(await this.store.get('characters', characterId))) throw new Error('角色不存在');
      const provider = await this.provider();
      const previous = await this.store.get('visualDrafts', characterId);
      const same =
        previous &&
        previous.providerId === provider.identity &&
        JSON.stringify(previous.input) === JSON.stringify(input);
      const draft = same
        ? previous
        : {
            id: characterId,
            characterId,
            createdAt: Date.now(),
            providerId: provider.identity,
            input,
            candidates: [] as ImageAsset[],
          };
      await this.store.put('visualDrafts', draft);
      if (input.mode === 'animate') {
        draft.selected = input.reference;
        await this.store.put('visualDrafts', draft);
      } else {
        for (let i = draft.candidates.length; i < 3; i++) {
          draft.candidates.push(await provider.candidate(input, i));
          await this.store.put('visualDrafts', draft);
        }
      }
      return draft;
    } finally {
      await this.store.release(lock);
      await this.store.release('visual-assets');
    }
  }
  async select(characterId: string, index?: number) {
    const lock = `visual:${characterId}`;
    if (!(await this.store.lease(lock, Date.now(), 45 * 60_000))) throw new Error('形象正在处理中');
    if (!(await this.store.lease('visual-assets', Date.now(), 45 * 60_000))) {
      await this.store.release(lock);
      throw new Error('图像资源正在处理中，请稍后继续');
    }
    try {
      const draft = await this.store.get('visualDrafts', characterId);
      if (!draft) throw new Error('请先生成形象');
      const provider = await this.provider();
      if (draft.providerId !== provider.identity)
        throw new Error('生图服务已改变，请重新生成候选图');
      const image = index === undefined ? draft.selected : draft.candidates[index];
      if (!image) throw new Error('请选择一张形象');
      const reuse = draft.selected?.uri === image.uri && draft.rig;
      draft.bodyRepairApplied = reuse ? draft.bodyRepairApplied : false;
      draft.selected = image;
      draft.rig = undefined;
      await this.store.put('visualDrafts', draft);
      draft.rig = reuse || validateRig(await provider.split(image));
      await this.store.put('visualDrafts', draft);
      return draft.rig;
    } finally {
      await this.store.release(lock);
      await this.store.release('visual-assets');
    }
  }
  async repairBody(characterId: string) {
    const lock = `visual:${characterId}`;
    if (!(await this.store.lease(lock, Date.now(), 45 * 60_000))) throw new Error('形象正在处理中');
    if (!(await this.store.lease('visual-assets', Date.now(), 45 * 60_000))) {
      await this.store.release(lock);
      throw new Error('图像资源正在处理中');
    }
    try {
      const draft = await this.store.get('visualDrafts', characterId);
      if (draft?.bodyRepairApplied && draft.rig) return draft.rig;
      const provider = await this.provider();
      if (
        !draft?.rig ||
        !draft.selected ||
        !provider.repairBody ||
        draft.providerId !== provider.identity
      )
        throw new Error('请先使用豆包创建形象，导入形象不能直接重复付费修复');
      const rig = await provider.repairBody(draft.selected, draft.rig);
      await this.store.put('visualDrafts', {
        ...draft,
        rig,
        saved: false,
        bodyRepairApplied: true,
      });
      return rig;
    } finally {
      await this.store.release(lock);
      await this.store.release('visual-assets');
    }
  }
  async saveMesh(characterId: string) {
    await this.store.atomic(async (tx) => {
      const draft = await tx.get('visualDrafts', characterId),
        c = await tx.get('characters', characterId);
      if (!c || !draft?.meshAvatar) throw new Error('网格角色尚未就绪');
      const meshAvatar = MeshAvatarSchema.parse(draft.meshAvatar);
      if (!(await this.assets.exists({ uri: meshAvatar.uri, width: 1, height: 1 })))
        throw new Error('网格模型文件缺失');
      await tx.put('characters', { ...c, meshAvatar, appearancePending: false });
      await tx.put('visualDrafts', { ...draft, saved: true });
    });
  }
  async save(characterId: string) {
    await this.store.atomic(async (tx) => {
      const draft = await tx.get('visualDrafts', characterId);
      const character = await tx.get('characters', characterId);
      if (!character || !draft?.rig) throw new Error('形象尚未完成');
      const rig = validateRig(draft.rig);
      for (const l of rig.layers)
        if (!(await this.assets.exists(l.asset))) throw new Error('图层文件缺失，请重新整理图层');
      await tx.put('characters', { ...character, rig, appearancePending: false });
      await tx.put('visualDrafts', { ...draft, saved: true });
    });
  }
}
export function validateImageSettings(config: ImageSettings): ImageSettings {
  const url = new URL(config.baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('生图接口必须使用不含凭据的 HTTPS 地址');
  if (![config.imageModel, config.layerModel].every((v) => /^[\w.-]{1,150}$/.test(v)))
    throw new Error('请填写有效的模型名称或 Endpoint ID');
  return { ...config, baseUrl: config.baseUrl.replace(/\/+$/, '') };
}
