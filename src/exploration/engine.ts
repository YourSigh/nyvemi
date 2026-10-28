import { id, type Character, type Experience } from '../domain/models';
import type { Storage } from '../storage/store';
import { overlap } from '../memory/retrieval';
import { ExperienceEngine } from '../experience/engine';
import { isQuietHour } from '../proactive/quiet-hours';
import type { ContentItem, ContentProvider } from './content';
export function contentInterest(c: Character, item: ContentItem): number {
  const text = `${item.title} ${item.description} ${item.category}`;
  if (c.persona.dislikes.some((t) => overlap(text, t) > 0.3)) return 0;
  return Math.max(
    0,
    ...c.persona.likes.map((t) => overlap(text, t)),
    ...c.interests.map((i) => overlap(text, i.topic) * i.score),
  );
}
export class ExplorationEngine {
  constructor(
    private store: Storage,
    private provider: ContentProvider,
  ) {}
  async run(characterId: string, now = Date.now()): Promise<string> {
    if (!(await this.store.lease(`exploration:${characterId}`, now, 60000))) return 'busy';
    const log = async (reason: string, data: Record<string, unknown> = {}) => {
      await this.store.put('diagnostics', {
        id: id(),
        characterId,
        kind: 'heartbeat',
        createdAt: now,
        data: { event: 'exploration', provider: this.provider.id, reason, ...data },
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
      if (!c || !settings?.proactiveEnabled) return 'disabled';
      if (isQuietHour(now, settings.quietStart, settings.quietEnd)) return 'quiet_hours';
      if (
        settings.lastExplorationAt !== undefined &&
        now - settings.lastExplorationAt < 4 * 3600000
      )
        return 'cooldown';
      // Claim before I/O: network errors are backoff, not a polling storm.
      await this.store.atomic(async (tx) => {
        const fresh = await tx.get('settings', characterId);
        if (fresh) await tx.put('settings', { ...fresh, lastExplorationAt: now });
      });
      let candidates: ContentItem[];
      try {
        candidates = await this.provider.candidates();
      } catch {
        return await log('provider_unavailable');
      }
      const history = await this.store.list('experiences', characterId, 10000);
      const seen = new Set(
        history.filter((e) => e.source === this.provider.id).map((e) => e.externalId),
      );
      const selected = candidates
        .filter((v) => !seen.has(v.id))
        .map((v) => ({ v, score: contentInterest(c, v) }))
        .filter((v) => v.score >= 0.12)
        .sort((a, b) => b.score - a.score)[0];
      if (!selected)
        return await log('no_interesting_unseen_content', { candidates: candidates.length });
      const v = selected.v;
      const experience: Experience = {
        id: id(),
        characterId,
        source: this.provider.id,
        externalId: v.id,
        title: v.title,
        content: `浏览记录：只读到了视频标题、简介和分区，没有播放视频或获取字幕。作者：${v.author}。分区：${v.category}。简介：${v.description}`,
        topics: [
          v.category,
          ...c.interests
            .filter((i) => overlap(`${v.title} ${v.description}`, i.topic) > 0.05)
            .map((i) => i.topic),
        ].filter(Boolean),
        url: v.url,
        createdAt: now,
      };
      await new ExperienceEngine(this.store).ingest(
        c,
        [{ id: this.provider.id, fetch: async () => [experience] }],
        now,
      );
      return await log('explored', {
        externalId: v.id,
        experienceId: experience.id,
        score: selected.score,
        candidates: candidates.length,
        evidence: 'metadata_only',
      });
    } finally {
      await this.store.release(`exploration:${characterId}`);
    }
  }
}
