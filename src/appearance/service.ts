import { restoreRigMetadata } from './rig-metadata';
import { MeshAvatarSchema } from '../avatar/model';
import { id } from '../domain/models';
import type { VisualBrief } from './brief';
import { fallbackVisualResearch, type VisualResearch, type VisualCheck } from './research';
import type { Storage } from '../storage/store';
import { ImageProviderError } from './errors';
import {
  type CharacterRig,
  type ImageAsset,
  type ImageSettings,
  type VisualInput,
  type VisualDraft,
  type VisualBuildProgress,
  validateRig,
  usesVisualResearch,
} from './model';
import { mockCandidate, mockRig } from './mock';
export interface ImageAssets {
  refineRig?(source: ImageAsset, rig: CharacterRig): Promise<CharacterRig>;
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
  split(
    image: ImageAsset,
    progress?: (value: VisualBuildProgress) => Promise<void>,
  ): Promise<CharacterRig>;
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
      onDraft?(draft: VisualDraft): void;
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
        previous.candidates.length < 3 &&
        !previous.generationFailure
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
      if (options.reviewAgain && draft.candidates.length !== 3 && !draft.generationFailure)
        throw Error('请先继续完成本批，再重新核对全部图片');
      if (draft.generationFailure && !options.reviewAgain)
        throw new ImageProviderError(draft.generationFailure);
      if (options.refreshResearch) {
        if (draft.candidates.length) throw Error('这批已有图片，请先选择新一批再更换参考');
        draft.research = undefined;
        draft.confirmedReferenceId = undefined;
        draft.imagePrompt = undefined;
      }
      await this.store.put('visualDrafts', draft);
      options.onDraft?.(draft);
      if (usesVisualResearch(draft.promptVersion) && !draft.research) {
        options.onStage?.('reference');
        const research = await this.assist(
          draft,
          'research',
          () => provider.research?.(input),
          fallbackVisualResearch(input),
        );
        draft.research = research;
        draft.brief = research.brief;
        await this.store.put('visualDrafts', draft);
        options.onDraft?.(draft);
      }
      if (draft.research) {
        // Uploading is already an explicit selection. Public references are optional enhancements.
        const requestedId = options.referenceId ?? draft.confirmedReferenceId;
        const reference = input.reference
          ? draft.research.references.find((r) => r.asset.uri === input.reference!.uri)
          : (draft.research.references.find(
              (r) => r.id === requestedId && r.check.status !== 'mismatch',
            ) ?? draft.research.references.find((r) => r.check.status === 'match'));
        if (draft.candidates.length && reference?.id !== draft.confirmedReferenceId)
          throw Error('本批已开始生图，请用新一批更换参考，避免混用形象');
        if (reference?.id !== draft.confirmedReferenceId) draft.imagePrompt = undefined;
        draft.confirmedReferenceId = reference?.id;
        await this.store.put('visualDrafts', draft);
        options.onDraft?.(draft);
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
        options.onDraft?.(draft);
      }
      if (draft.promptVersion === 4 && !draft.imagePrompt) {
        options.onStage?.('prompt');
        const reference = draft.research?.references.find(
          (r) => r.id === draft.confirmedReferenceId,
        );
        const planned = {
          ...input,
          reference: reference?.asset ?? input.reference,
          brief: reference
            ? { ...draft.brief!, recognizableFeatures: reference.check.features }
            : draft.brief,
        };
        draft.imagePrompt = await this.assist(
          draft,
          'prompt',
          async () => {
            const prompt = await provider.composePrompt?.(planned);
            return prompt?.trim() || undefined;
          },
          `用户原始要求：${input.description}。保留用户指定的身份、外观和风格；参考图（如有）为造型依据。单人正面全身，双手分开，双眼睁开，结构清晰，简单背景。`,
        );
        await this.store.put('visualDrafts', draft);
        options.onDraft?.(draft);
      }
      if (options.planOnly && usesVisualResearch(draft.promptVersion)) return draft;
      if (input.mode === 'animate') {
        draft.selected = input.reference;
        await this.store.put('visualDrafts', draft);
        options.onDraft?.(draft);
      } else {
        options.onStage?.('generation');
        const count = options.reviewAgain ? draft.candidates.length : 3;
        for (let i = 0; i < count; i++) {
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
            try {
              draft.candidates.push(await provider.candidate(planned, i));
            } catch (error) {
              if (
                error instanceof ImageProviderError &&
                error.failure.category === 'content_review'
              ) {
                draft.generationFailure = error.failure;
                await this.store.put('visualDrafts', draft);
                options.onDraft?.(draft);
              }
              throw error;
            }
            // Persist the paid result before any fallible vision call.
            await this.store.put('visualDrafts', draft);
            options.onDraft?.(draft);
          }
          if (
            usesVisualResearch(draft.promptVersion) &&
            (!draft.candidateReviews?.[i] || options.reviewAgain)
          ) {
            options.onStage?.('review');
            const review = await this.assist(
              draft,
              'review',
              () => provider.review?.(planned, draft.candidates[i]),
              {
                status: 'uncertain' as const,
                features: [],
                issues: ['自动核对未完成，请直接看图选择'],
              },
            );
            draft.candidateReviews ??= [];
            draft.candidateReviews[i] = review;
            await this.store.put('visualDrafts', draft);
            options.onDraft?.(draft);
          }
        }
      }
      return draft;
    } finally {
      await this.store.release(lock);
      await this.store.release('visual-assets');
    }
  }
  private async assist<T>(
    draft: VisualDraft,
    stage: 'research' | 'prompt' | 'review' | 'repair',
    work: () => Promise<T | undefined> | undefined,
    fallback: T,
  ): Promise<T> {
    try {
      const value = await work();
      if (value !== undefined) return value;
    } catch {
      /* Auxiliary API/schema/web failures cannot turn a valid drawing request into a dead end. */
    }
    const code = `${stage}_unavailable` as const;
    draft.advisories = [...new Set([...(draft.advisories ?? []), code])];
    await this.store.put('diagnostics', {
      id: id(),
      characterId: draft.characterId,
      createdAt: Date.now(),
      kind: 'error',
      data: { event: 'visual_assistance_failed', stage },
    });
    return fallback;
  }
  async restoreLook(characterId: string) {
    const lock = `visual:${characterId}`;
    if (!(await this.store.lease(lock, Date.now(), 5 * 60_000)))
      return this.store.get('visualDrafts', characterId);
    if (!(await this.store.lease('visual-assets', Date.now(), 5 * 60_000))) {
      await this.store.release(lock);
      return this.store.get('visualDrafts', characterId);
    }
    try {
      const draft = await this.store.get('visualDrafts', characterId);
      if (
        !draft?.rig ||
        !draft.selected ||
        !this.assets.refineRig ||
        (draft.build && draft.build.stage !== 'ready')
      )
        return draft;
      const rig = await this.assets.refineRig(
        draft.selected,
        await restoreRigMetadata(this.store, draft.rig),
      );
      if (rig !== draft.rig) {
        await this.store.put('visualDrafts', { ...draft, rig });
        const c = await this.store.get('characters', characterId);
        if (draft.saved && c?.rig) await this.store.put('characters', { ...c, rig });
        return { ...draft, rig };
      }
      return draft;
    } finally {
      await this.store.release(lock);
      await this.store.release('visual-assets');
    }
  }
  async select(
    characterId: string,
    index?: number,
    progress?: (value: VisualBuildProgress) => void,
  ) {
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
      const reuse =
        draft.selected?.uri === image.uri &&
        draft.rig &&
        matches(provider, draft.layerProviderId ?? draft.providerId, 'layers')
          ? draft.rig
          : undefined;
      const sameSelection = draft.selected?.uri === image.uri;
      draft.bodyRepairApplied = reuse ? draft.bodyRepairApplied : false;
      draft.armRepairApplied = reuse ? draft.armRepairApplied : false;
      draft.automaticArmRepairAttempted = sameSelection ? draft.automaticArmRepairAttempted : false;
      draft.selected = image;
      const publish = async (value: VisualBuildProgress) => {
        draft.build = value;
        await this.store.put('visualDrafts', draft);
        progress?.(value);
      };
      try {
        await publish({
          stage: 'layers',
          source: image,
          completed: 0,
          preview: reuse ?? (sameSelection ? draft.build?.preview : undefined),
        });
        draft.rig = reuse || validateRig(await provider.split(image, publish));
        draft.layerProviderId = provider.identity;
        await publish({
          stage: 'checking',
          source: image,
          completed: draft.rig.layers.length,
          total: draft.rig.layers.length,
          preview: draft.rig,
        });
        if (
          draft.rig.source === 'seedream' &&
          draft.rig.layers.filter((l) => l.role === 'arm').length < 2 &&
          provider.repairArms &&
          !draft.automaticArmRepairAttempted
        ) {
          draft.automaticArmRepairAttempted = true;
          await publish({ ...draft.build!, stage: 'repairing_arms' });
          draft.rig = await this.assist(
            draft,
            'repair',
            async () => {
              const result = await provider.repairArms!(image, draft.rig!);
              draft.armRepairApplied = true;
              return result;
            },
            draft.rig,
          );
        }
        await publish({ ...draft.build!, stage: 'finishing', preview: draft.rig });
        draft.rig = await restoreRigMetadata(this.store, draft.rig);
        if (this.assets.refineRig) draft.rig = await this.assets.refineRig(image, draft.rig);
        draft.saved = false;
        await publish({
          stage: 'ready',
          source: image,
          preview: draft.rig,
          completed: draft.rig.layers.length,
          total: draft.rig.layers.length,
        });
        return draft.rig;
      } catch (error) {
        await publish({ ...draft.build!, stage: 'failed', failedStage: draft.build?.stage });
        throw error;
      }
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
      let rig = await repair.call(provider, draft.selected, draft.rig);
      if (this.assets.refineRig) rig = await this.assets.refineRig(draft.selected, rig);
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
      if (!character || !draft?.rig || (draft.build && draft.build.stage !== 'ready'))
        throw new Error('形象尚未完成');
      const rig = validateRig(draft.rig);
      for (const l of rig.layers)
        if (!(await this.assets.exists(l.asset))) throw new Error('图层文件缺失，请重新整理图层');
      await tx.put('characters', {
        ...character,
        rig,
        meshAvatar: undefined,
        appearancePending: false,
      });
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
