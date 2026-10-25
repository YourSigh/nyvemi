import type { Message } from '../domain/models';
import type { Storage } from '../storage/store';
import { Diagnostics } from '../storage/diagnostics';
import { MemoryRepository } from './repository';
import { KeywordMemoryRetriever } from './retrieval';
export function recallQuery(latest: string, history: Message[]): string {
  if (/换个话题|不聊这个|新话题|先不说这个/.test(latest)) return latest;
  if (
    latest.length > 120 ||
    !/那个|这件事|这事|之前|上次|刚才|后来|怎么样|然后呢|后续|结果呢|接着聊|继续聊|还记得/.test(
      latest,
    )
  )
    return latest;
  const anchors = history
    .filter((m) => m.role === 'user' && m.status === 'complete' && m.content !== latest)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 2)
    .map((m) => m.content.slice(0, 240));
  return [latest, ...anchors].join('\n');
}
/** Contextual lexical recall remains replaceable by a future embedding retriever. */
export class MemoryRecall {
  constructor(
    private store: Storage,
    private diagnostics: Diagnostics,
  ) {}
  async retrieve(characterId: string, latest: string, now = Date.now()) {
    const query = recallQuery(latest, await this.store.list('messages', characterId, 16));
    const repo = new MemoryRepository(this.store);
    const ranked = new KeywordMemoryRetriever().rank(query, await repo.list(characterId, now), now);
    await repo.touch(
      ranked.map((r) => r.memory),
      now,
    );
    if ((await this.store.get('settings', characterId))?.developerMode)
      await this.diagnostics.record('retrieval', characterId, {
        query,
        results: ranked.map((r) => ({
          id: r.memory.id,
          content: r.memory.content,
          score: r.score,
          keyword: r.keyword,
        })),
      });
    return ranked.map((r) => r.memory);
  }
}
