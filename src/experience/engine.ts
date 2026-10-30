import {
  id,
  type Character,
  type Experience,
  type ExperienceAppraisal,
  type Memory,
} from '../domain/models';
import type { Storage } from '../storage/store';
import { MemoryRepository } from '../memory/repository';
import { appraiseExperience, updateInterests } from './appraisal';
import type { ExperienceSource } from './sources';
export class ExperienceEngine {
  constructor(private store: Storage) {}
  async ingest(
    character: Character,
    sources: ExperienceSource[],
    now: number,
    onError: (source: string) => Promise<void> = async () => {},
    evaluate: (
      item: Experience,
      character: Character,
      memories: Memory[],
    ) => ExperienceAppraisal = appraiseExperience,
  ): Promise<void> {
    const existing = await this.store.list('experiences', character.id, 10000);
    const seen = new Set(existing.map((e) => `${e.source}:${e.externalId}`));
    const rssContents = new Set(
      existing
        .filter((e) => e.source.startsWith('rss:'))
        .map((e) => `${e.title.trim().toLowerCase()}|${e.content.trim().slice(0, 500)}`),
    );
    const rssUrls = new Set(
      existing.filter((e) => e.source.startsWith('rss:') && e.url).map((e) => e.url),
    );
    const memories = await new MemoryRepository(this.store).list(character.id, now);
    let current = character;
    for (const source of sources) {
      let items: Experience[];
      try {
        items = await source.fetch();
      } catch {
        await onError(source.id);
        continue;
      }
      for (const item of items) {
        const key = `${item.source}:${item.externalId}`;
        const contentKey = `${item.title.trim().toLowerCase()}|${item.content.trim().slice(0, 500)}`;
        const rss = item.source.startsWith('rss:');
        if (
          seen.has(key) ||
          item.characterId !== character.id ||
          (rss && (rssContents.has(contentKey) || (item.url && rssUrls.has(item.url))))
        )
          continue;
        seen.add(key);
        if (rss) {
          rssContents.add(contentKey);
          if (item.url) rssUrls.add(item.url);
        }
        const experience = { ...item, appraisal: evaluate(item, current, memories) };
        await this.store.atomic(async (tx) => {
          current = (await tx.get('characters', character.id)) ?? current;
          experience.appraisal = evaluate(item, current, memories);
          await tx.put('experiences', experience);
          current = {
            ...current,
            interests: updateInterests(current.interests, experience, now),
            state: {
              ...current.state,
              curiosityTopics:
                experience.appraisal.selfInterest >= 0.5
                  ? [
                      ...new Set([
                        experience.title.slice(0, 120),
                        ...current.state.curiosityTopics,
                      ]),
                    ].slice(0, 6)
                  : current.state.curiosityTopics,
            },
          };
          if (experience.source === 'local-time')
            current = {
              ...current,
              state: {
                ...current.state,
                energy: experience.title === 'late night' ? 0.25 : 0.7,
                mood: experience.title === 'weekend' ? '松弛' : current.state.mood,
              },
            };
          await tx.put('characters', current);
          if (['bilibili', 'mock-bilibili', 'agent-web'].includes(experience.source))
            await new MemoryRepository(tx).upsert(
              character.id,
              'experience',
              `${experience.title}。${experience.content} 来源：${experience.url ?? experience.source}`,
              experience.appraisal.shareImpulse,
              now,
              now + 30 * 86400000,
              experience.source,
            );

          if (
            experience.appraisal.shareImpulse >= 0.7 &&
            (experience.source.startsWith('rss:') ||
              ['bilibili', 'mock-bilibili', 'agent-web'].includes(experience.source))
          )
            await tx.put('intentions', {
              id: id(),
              characterId: character.id,
              type: 'share',
              topic: experience.title,
              reason: experience.appraisal.memoryAssociation ?? '角色遇到与自己的兴趣相关的事',
              importance: experience.appraisal.shareImpulse,
              earliestAt: now + 30 * 60000,
              latestAt: now + 18 * 3600000,
              status: 'pending',
              experienceId: experience.id,
              createdAt: now,
            });
        });
      }
    }
    // Bounded local timeline. Older data remains in conversations/memories; do not accumulate time ticks forever.
    for (const e of existing)
      if (e.source === 'local-time' && now - e.createdAt > 30 * 86400000)
        await this.store.remove('experiences', e.id);
  }
}
