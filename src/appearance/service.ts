import { MeshAvatarSchema } from '../avatar/model';
import { id } from '../domain/models';
import type { VisualBrief } from './brief';
import type { VisualResearch, VisualCheck } from './research';
import type { Storage } from '../storage/store';
import {
  type CharacterRig,
  type ImageAsset,
  type ImageSettings,
  type VisualInput,
  type VisualDraft,
  validateRig,
  usesVisualResearch,
} from './model';
import { mockCandidate, mockRig } from './mock';
export interface ImageAssets {
  fingerprint(asset: ImageAsset): Promise<string>;
  dataUrl(asset: ImageAsset): Promise<string>;
  prepareDecomposition?(
    asset: ImageAsset,
  ): Promise<{ dataUrl: string; width: number; height: number }>;
  download(url: string, key: string, signal?: AbortSignal): Promise<ImageAsset>;
  exists(asset: ImageAsset): Promise<boolean>;
}
export interface ImageProvider {
  identity: string;
  matchesIdentity?(previous: string, scope: 'generation' | 'layers' | 'endpoint'): boolean;
  adoptLegacyIdentity?(previous: string): void;
  supportsResearch?: boolean;
  research?(input: VisualInput): Promise<VisualResearch | undefined>;
  review?(input: VisualInput, image: ImageAsset): Promise<VisualCheck | undefined>;
  prepare?(input: VisualInput): Promise<VisualBrief | undefined>;
  composePrompt?(input: VisualInput): Promise<string>;
  supportsPromptPlanning?: boolean;
  candidate(input: VisualInput, index: number): Promise<ImageAsset>;
  split(image: ImageAsset): Promise<CharacterRig>;
  repairBody?(image: ImageAsset, rig: CharacterRig): Promise<CharacterRig>;
  repairArms?(image: ImageAsset, rig: CharacterRig): Promise<CharacterRig>;
}
function matches(
  provider: ImageProvider,
  previous: string,
  scope: 'generation' | 'layers' | 'endpoint',
) {
  return provider.identity === previous || provider.matchesIdentity?.(previous, scope) === true;
}
function adopt(provider: ImageProvider, draft: VisualDraft | undefined) {
  if (!draft) return;
  provider.adoptLegacyIdentity?.(draft.providerId);
  if (draft.layerProviderId) provider.adoptLegacyIdentity?.(draft.layerProviderId);
}
export class MockImageProvider implements ImageProvider {
  identity = 'mock-v1';
  async candidate(input: VisualInput, index: number) {
    return mockCandidate(`${input.description}:${input.generationId ?? ''}:${index}`);
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
  async generate(
    characterId: string,
    input: VisualInput,
    options: {
      regenerate?: boolean;
      referenceId?: string;
      reviewAgain?: boolean;
      planOnly?: boolean;
      refreshResearch?: boolean;
      onStage?(stage: 'brief' | 'reference' | 'prompt' | 'generation' | 'review'): void;
    } = {},
  ) {
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
      adopt(provider, previous);
      if (
        options.regenerate &&
        previous &&
        previous.input.mode !== 'animate' &&
        previous.candidates.length < 3
      )
        throw new Error('上一批候选尚未完成，请先继续生成或核对服务商记录，避免重复付费');
      const same =
        !options.regenerate &&
        previous &&
        matches(provider, previous.providerId, 'generation') &&
        JSON.stringify(previous.input) === JSON.stringify(input);
      const draft: VisualDraft = same
        ? previous
        : {
            id: characterId,
            characterId,
            createdAt: Date.now(),
            providerId: provider.identity,
            input,
            candidates: [] as ImageAsset[],
            promptVersion:
              provider.supportsResearch && input.mode !== 'animate'
                ? provider.supportsPromptPlanning
                  ? 4
                  : 3
                : 2,
            ...(options.regenerate ? { generationId: id() } : {}),
          };
      if (
        options.regenerate &&
        previous &&
        JSON.stringify(previous.input) === JSON.stringify(input) &&
        matches(provider, previous.providerId, 'generation') &&
        usesVisualResearch(previous.promptVersion)
      ) {
        draft.research = previous.research;
        draft.brief = previous.brief;
        draft.confirmedReferenceId = previous.confirmedReferenceId;
        draft.imagePrompt = previous.imagePrompt;
      }
      if (options.reviewAgain && draft.candidates.length !== 3)
        throw Error('请先继续完成本批，再重新核对全部图片');
      if (options.refreshResearch) {
        if (draft.candidates.length) throw Error('这批已有图片，请先选择新一批再更换参考');
        draft.research = undefined;
        draft.confirmedReferenceId = undefined;
        draft.imagePrompt = undefined;
      }
      await this.store.put('visualDrafts', draft);
      if (usesVisualResearch(draft.promptVersion) && !draft.research) {
        options.onStage?.('reference');
        const research = await provider.research?.(input);
        if (!research) throw Error('角色核对服务暂不可用；尚未生图');
        draft.research = research;
        draft.brief = research.brief;
        await this.store.put('visualDrafts', draft);
      }
      if (draft.research && draft.research.status !== 'ready') {
        const referenceId = options.referenceId ?? draft.confirmedReferenceId;
        const reference = draft.research.references.find((r) => r.id === referenceId);
        if (!reference || draft.research.status === 'needs_reference') return draft;
        if (reference.check.status === 'mismatch') throw Error('参考图与角色不符，请换一张参考图');
        if (draft.candidates.length && referenceId !== draft.confirmedReferenceId)
          throw Error('本批已开始生图，请用新一批更换参考，避免混用形象');
        if (reference.id !== draft.confirmedReferenceId) draft.imagePrompt = undefined;
        draft.confirmedReferenceId = reference.id;
        await this.store.put('visualDrafts', draft);
      }
      if (
        !same &&
        !usesVisualResearch(draft.promptVersion) &&
        input.mode !== 'animate' &&
        provider.prepare
      ) {
        options.onStage?.('brief');
        draft.brief = await provider.prepare(input);
        await this.store.put('visualDrafts', draft);
      }
      if (draft.promptVersion === 4 && !draft.imagePrompt) {
        options.onStage?.('prompt');
        if (!provider.composePrompt) throw Error('提示词整理暂不可用；尚未生图');
        const reference = draft.research?.references.find(
          (r) => r.id === draft.confirmedReferenceId,
        );
        draft.imagePrompt = await provider.composePrompt({
          ...input,
          reference: reference?.asset ?? input.reference,
          brief: reference
            ? { ...draft.brief!, recognizableFeatures: reference.check.features }
            : draft.brief,
        });
        if (!draft.imagePrompt.trim()) throw Error('提示词为空；尚未生图');
        await this.store.put('visualDrafts', draft);
      }
      if (options.planOnly && usesVisualResearch(draft.promptVersion)) return draft;
      if (input.mode === 'animate') {
        draft.selected = input.reference;
        await this.store.put('visualDrafts', draft);
      } else {
        options.onStage?.('generation');
        for (let i = 0; i < 3; i++) {
          const reference = draft.research?.references.find(
            (r) => r.id === draft.confirmedReferenceId,
          );
          const anchorIndex = draft.candidateReviews?.findIndex((r) => r?.status === 'match') ?? -1;
          const planned: VisualInput = {
            ...input,
            reference: reference?.asset ?? input.reference,
            anchor:
              usesVisualResearch(draft.promptVersion) && anchorIndex >= 0 && anchorIndex < i
                ? draft.candidates[anchorIndex]
                : undefined,
            imagePrompt: draft.imagePrompt,
            brief: reference
              ? { ...draft.brief!, recognizableFeatures: reference.check.features }
              : draft.brief,
            promptVersion: draft.promptVersion,
            generationId: draft.generationId,
          };
          if (!draft.candidates[i]) {
            options.onStage?.('generation');
            draft.candidates.push(await provider.candidate(planned, i));
            // Persist the paid result before any fallible vision call.
            await this.store.put('visualDrafts', draft);
          }
          if (
            usesVisualResearch(draft.promptVersion) &&
            (!draft.candidateReviews?.[i] || options.reviewAgain)
          ) {
            options.onStage?.('review');
            const review = await provider.review?.(planned, draft.candidates[i]);
            if (!review) throw Error('图片已保留，核对暂不可用；重试只核对，不重复生图');
            draft.candidateReviews ??= [];
            draft.candidateReviews[i] = review;
            await this.store.put('visualDrafts', draft);
          }
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
      if (!matches(provider, draft.providerId, 'endpoint'))
        throw new Error('生图服务地址已改变，请先确认当前服务与形象');
      adopt(provider, draft);
      const image = index === undefined ? draft.selected : draft.candidates[index];
      if (!image) throw new Error('请选择一张形象');
      if (usesVisualResearch(draft.promptVersion)) {
        const check = index === undefined ? undefined : draft.candidateReviews?.[index];
        if (!check || check.status !== 'match')
          throw Error('这张图尚未通过特征核对，请重新核对或更换参考；尚未拆层');
      }
      const reuse =
        draft.selected?.uri === image.uri &&
        draft.rig &&
        matches(provider, draft.layerProviderId ?? draft.providerId, 'layers')
          ? draft.rig
          : undefined;
      draft.bodyRepairApplied = reuse ? draft.bodyRepairApplied : false;
      draft.armRepairApplied = reuse ? draft.armRepairApplied : false;
      draft.selected = image;
      draft.rig = undefined;
      await this.store.put('visualDrafts', draft);
      draft.rig = reuse || validateRig(await provider.split(image));
      draft.layerProviderId = provider.identity;
      await this.store.put('visualDrafts', draft);
      return draft.rig;
    } finally {
      await this.store.release(lock);
      await this.store.release('visual-assets');
    }
  }
  async repairBody(characterId: string) {
    return this.repairPart(characterId, 'body');
  }
  async repairArms(characterId: string) {
    return this.repairPart(characterId, 'arms');
  }
  private async repairPart(characterId: string, part: 'body' | 'arms') {
    const lock = `visual:${characterId}`;
    if (!(await this.store.lease(lock, Date.now(), 45 * 60_000))) throw new Error('形象正在处理中');
    if (!(await this.store.lease('visual-assets', Date.now(), 45 * 60_000))) {
      await this.store.release(lock);
      throw new Error('图像资源正在处理中');
    }
    try {
      const draft = await this.store.get('visualDrafts', characterId);
      const flag = part === 'body' ? 'bodyRepairApplied' : 'armRepairApplied';
      if (draft?.[flag] && draft.rig) return draft.rig;
      const provider = await this.provider();
      const repair = part === 'body' ? provider.repairBody : provider.repairArms;
      if (
        !draft?.rig ||
        !draft.selected ||
        !repair ||
        !matches(provider, draft.layerProviderId ?? draft.providerId, 'layers')
      )
        throw new Error('请先使用豆包创建形象，导入形象不能直接重复付费修复');
      adopt(provider, draft);
      const rig = await repair.call(provider, draft.selected, draft.rig);
      await this.store.put('visualDrafts', {
        ...draft,
        rig,
        saved: false,
        [flag]: true,
        layerProviderId: provider.identity,
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
  return { ...config, baseUrl: config.baseUrl.replace(/\/+$/, ''), routingVersion: 1 };
}
