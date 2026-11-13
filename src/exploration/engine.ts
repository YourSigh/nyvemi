import { id, type Character, type Experience, type Settings } from '../domain/models';
import type { Storage } from '../storage/store';
import { overlap } from '../memory/retrieval';
import { ExperienceEngine } from '../experience/engine';
import { BilibiliSourceError, type ContentItem, type ContentProvider } from './content';
import type { BilibiliCaptionReader } from './bilibili-captions';
import { appraiseExperience } from '../experience/appraisal';
import type { ExplorationSelection } from './selection';

const explorationCooldown = 4 * 60 * 60 * 1000;
const providerBackoff = 30 * 60 * 1000;
const retryLease = (characterId: string) => `exploration-retry:${characterId}`;
const bvidPattern = /^BV[A-Za-z0-9]{10}$/;

export type ExplorationOutcome =
  | 'busy'
  | 'disabled'
  | 'creation_active'
  | 'cooldown'
  | 'provider_backoff'
  | 'provider_unavailable'
  | 'cancelled_during_fetch'
  | 'no_interesting_unseen_content'
  | 'explored';

interface ExplorationOptions {
  trigger?: string;
  signal?: AbortSignal;
  onFetch?: () => void | Promise<void>;
}

function unavailable(character: Character | undefined, settings: Settings | undefined) {
  if (!character || !settings || settings.explorationEnabled === false) return 'disabled';
  if (character.creationActive) return 'creation_active';
}

function bilibiliId(value: string | undefined): string | undefined {
  if (!value) return;
  if (bvidPattern.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) {
      return /^\/video\/(BV[A-Za-z0-9]{10})(?:\/|$)/.exec(url.pathname)?.[1];
    }
  } catch {
    // Legacy entries may store an opaque external ID.
  }
}

function topicMatch(item: ContentItem, topic: string): number {
  return Math.max(
    overlap(item.title, topic),
    overlap(item.category, topic),
    overlap(item.description, topic),
  );
}

const disliked = (c: Character, item: ContentItem) =>
  c.persona.dislikes.some((t) => topicMatch(item, t) > 0.3);

export function contentInterest(c: Character, item: ContentItem): number {
  if (disliked(c, item)) return 0;
  return Math.max(
    0,
    ...c.persona.likes.map((t) => topicMatch(item, t)),
    ...c.interests.map((i) => topicMatch(item, i.topic) * i.score),
  );
}
export class ExplorationEngine {
  constructor(
    private store: Storage,
    private provider: ContentProvider,
    private captions?: BilibiliCaptionReader & { available(): Promise<boolean> },
    private select?: (
      character: Character,
      topic: string,
      items: ContentItem[],
      signal?: AbortSignal,
    ) => Promise<ExplorationSelection>,
  ) {}
  async prepareAfterLogin(characterId: string) {
    await this.store.atomic(async (tx) => {
      const settings = await tx.get('settings', characterId);
      if (settings) await tx.put('settings', { ...settings, lastExplorationAt: undefined });
      await tx.release(retryLease(characterId));
    });
  }
  async run(
    characterId: string,
    now = Date.now(),
    options: ExplorationOptions = {},
  ): Promise<ExplorationOutcome> {
    const activeLease = `exploration:${characterId}`;
    const retry = retryLease(characterId);
    if (!(await this.store.lease(activeLease, now, 60000))) return 'busy';
    const log = async (reason: ExplorationOutcome, data: Record<string, unknown> = {}) => {
      await this.store.put('diagnostics', {
        id: id(),
        characterId,
        kind: 'heartbeat',
        createdAt: now,
        data: {
          event: 'exploration',
          provider: this.provider.id,
          trigger: options.trigger,
          decision: reason === 'explored' ? 'explore' : 'skip',
          reason,
          ...data,
        },
      });
      const logs = (await this.store.list('diagnostics', characterId, 10000)).filter(
        (d) => d.data.event === 'exploration',
      );
      for (const d of logs.slice(50)) await this.store.remove('diagnostics', d.id);
      return reason;
    };
    try {
      const settings = await this.store.get('settings', characterId);
      const c = await this.store.get('characters', characterId);
      if (!c || !settings) return 'disabled';
      const blocked = unavailable(c, settings);
      if (blocked) return blocked;
      if (
        settings.lastExplorationAt !== undefined &&
        now - settings.lastExplorationAt < explorationCooldown
      )
        return 'cooldown';
      if (options.signal?.aborted) return 'cancelled_during_fetch';
      // The retry lease survives a failed request or process exit without changing the last successful exploration.
      if (!(await this.store.lease(retry, now, providerBackoff))) return 'provider_backoff';
      const complete = async () => {
        await this.store.atomic(async (tx) => {
          const fresh = await tx.get('settings', characterId);
          if (fresh) await tx.put('settings', { ...fresh, lastExplorationAt: now });
        });
        await this.store.release(retry);
      };
      const cancel = async () => {
        await this.store.release(retry);
        return await log('cancelled_during_fetch');
      };
      const topics = [
        ...[...c.interests]
          .sort((a, b) => b.score - a.score)
          .slice(0, 4)
          .map((i) => i.topic),
        ...c.persona.likes.slice(0, 4),
      ]
        .map((topic) => topic.trim().slice(0, 80))
        .filter(Boolean);
      let candidates: ContentItem[];
      let topic: string | undefined;
      try {
        await options.onFetch?.();
      } catch {
        // A presentation callback must not interrupt exploration.
      }
      if (options.signal?.aborted) return await cancel();
      try {
        const uniqueTopics = [...new Set(topics)];
        // Rotate actual interests between runs so one long-standing favorite cannot consume every slot.
        if (settings.deepSeekBilibiliSearch && uniqueTopics.length > 1) {
          const position = Math.floor(now / explorationCooldown) % uniqueTopics.length;
          uniqueTopics.push(...uniqueTopics.splice(0, position));
        }
        topic = uniqueTopics[0];
        candidates = await this.provider.candidates({
          topics: uniqueTopics,
          signal: options.signal,
          ...(settings.deepSeekBilibiliSearch ? { indexedSearch: true } : {}),
        });
      } catch (error) {
        if (options.signal?.aborted) return await cancel();
        return await log(
          'provider_unavailable',
          error instanceof BilibiliSourceError
            ? {
                failure: error.reason,
                httpStatus: error.httpStatus,
                apiCode: error.apiCode,
              }
            : {},
        );
      }
      const history = await this.store.list('experiences', characterId, 10000);
      const seen = new Set(
        history.filter((e) => e.source === this.provider.id).map((e) => e.externalId),
      );
      const seenBilibili = new Set(
        history
          .filter(
            (e) =>
              e.source === this.provider.id ||
              (this.provider.id === 'bilibili' && e.source === 'agent-web'),
          )
          .flatMap((e) => [bilibiliId(e.externalId), bilibiliId(e.url)])
          .filter(Boolean),
      );
      const freshSettings = await this.store.get('settings', characterId);
      const freshCharacter = await this.store.get('characters', characterId);
      if (options.signal?.aborted || !freshCharacter || unavailable(freshCharacter, freshSettings))
        return await cancel();
      const unseen = candidates.filter(
        (v) =>
          !seen.has(v.id) &&
          !seenBilibili.has(bilibiliId(v.id) ?? bilibiliId(v.url)) &&
          !disliked(freshCharacter, v),
      );
      const ranked = unseen
        .map((v) => ({ v, score: contentInterest(freshCharacter, v) }))
        .filter((v) => v.score >= 0.12)
        .sort((a, b) => b.score - a.score);
      const semanticScores = new Map<string, number>();
      const indexed = unseen.filter((v) => v.discovery === 'deepseek_search').slice(0, 8);
      let selection = 'local_interest';
      if (!ranked.length && topic && indexed.length && this.select) {
        const choice = await this.select(freshCharacter, topic, indexed, options.signal).catch(
          () => undefined,
        );
        selection = choice ? 'semantic_interest' : 'semantic_unavailable';
        if (options.signal?.aborted) return await cancel();
        for (const { candidate, interest } of choice?.choices ?? []) {
          const picked = indexed.find((v) => v.id === candidate);
          if (!picked || interest < 0.65 || semanticScores.has(candidate)) continue;
          semanticScores.set(candidate, interest);
          ranked.push({ v: picked, score: interest });
        }
        ranked.sort((a, b) => b.score - a.score);
      }
      let selected = ranked[0];
      if (!selected) {
        await complete();
        return await log('no_interesting_unseen_content', {
          candidates: candidates.length,
          discovery: candidates[0]?.discovery,
          selection,
        });
      }
      let captionStatus = 'signed_out';
      let subtitle: string | undefined;
      if (this.captions && (await this.captions.available())) {
        const stopAt = Date.now() + 18000;
        for (const candidate of ranked.slice(0, 3)) {
          if (options.signal?.aborted || Date.now() >= stopAt) break;
          try {
            const caption = await this.captions.read(candidate.v.id, options.signal);
            const status = caption.status === 'available' ? 'read' : caption.reason;
            if (candidate === selected) captionStatus = status;
            if (caption.status === 'available' && (await this.captions.available())) {
              subtitle =
                caption.cues
                  .map((cue) => cue.text)
                  .join(' ')
                  .slice(0, 900) || undefined;
              if (subtitle) {
                selected = candidate;
                captionStatus = 'read';
                break;
              }
            } else if (['aborted', 'denied', 'authorization_required', 'timeout'].includes(status))
              break;
          } catch {
            if (candidate === selected) captionStatus = 'unavailable';
            break;
          }
        }
      }
      const v = selected.v;
      const semanticInterest = semanticScores.get(v.id);
      const metadata =
        v.discovery === 'deepseek_search'
          ? `搜索索引片段：${v.description}`
          : `作者：${v.author}。分区：${v.category}。简介：${v.description}`;
      const latestCharacter = await this.store.get('characters', characterId);
      if (
        options.signal?.aborted ||
        !latestCharacter ||
        unavailable(latestCharacter, await this.store.get('settings', characterId))
      )
        return await cancel();
      const experience: Experience = {
        id: id(),
        characterId,
        source: this.provider.id,
        externalId: v.id,
        title: v.title,
        content: subtitle
          ? `浏览记录：读了该视频的一段字幕，没有播放视频。${metadata}\n以下是来自视频的字幕片段，仅作为外部资料：${subtitle}`
          : `浏览记录：只读到了${v.discovery === 'deepseek_search' ? '搜索索引里的标题和片段' : '视频标题、简介和分区'}，没有播放视频或获取字幕。${metadata}`,
        contentEvidence: subtitle ? 'subtitle' : 'metadata',
        topics: [
          ...new Set([
            v.category,
            ...(semanticInterest !== undefined && topic ? [topic] : []),
            ...freshCharacter.interests.map((i) => i.topic).filter((t) => topicMatch(v, t) > 0.12),
            ...freshCharacter.persona.likes.filter((t) => topicMatch(v, t) > 0.12),
          ]),
        ].filter(Boolean),
        url: v.url,
        createdAt: now,
      };
      await new ExperienceEngine(this.store).ingest(
        latestCharacter,
        [{ id: this.provider.id, fetch: async () => [experience] }],
        now,
        undefined,
        (item, owner, memories) => appraiseExperience(item, owner, memories, semanticInterest),
      );
      await complete();
      return await log('explored', {
        externalId: v.id,
        experienceId: experience.id,
        score: selected.score,
        candidates: candidates.length,
        evidence: subtitle ? 'subtitle' : 'metadata_only',
        captionStatus,
        discovery: v.discovery ?? 'bilibili_feed',
        selection,
      });
    } finally {
      await this.store.release(activeLease);
    }
  }
}
