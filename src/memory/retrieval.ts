import type { Memory } from '../domain/models';
const stop = new Set([
  '今天',
  '一个',
  '这个',
  '那个',
  '自己',
  '用户',
  '我们',
  '你们',
  '可以',
  '时候',
  '什么',
  '一下',
  '觉得',
  '已经',
  '还是',
  '真的',
  '就是',
  '所以',
]);
export function keywords(text: string): Set<string> {
  const lower = text.toLowerCase();
  const tokens: string[] = [...(lower.match(/[a-z0-9_]{2,}/g) ?? [])];
  for (const run of lower.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (run.length === 1) tokens.push(run);
    else
      for (let n = 0; n < run.length - 1; n++) {
        const token = run.slice(n, n + 2);
        if (!stop.has(token)) tokens.push(token);
      }
  }
  return new Set(tokens);
}
export function overlap(a: string, b: string): number {
  const x = keywords(a),
    y = keywords(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const token of x) if (y.has(token)) shared++;
  return shared / Math.sqrt(x.size * y.size);
}
export interface RankedMemory {
  memory: Memory;
  score: number;
  keyword: number;
}
export interface MemoryRetriever {
  rank(query: string, memories: Memory[], now: number, limit?: number): RankedMemory[];
}
export class KeywordMemoryRetriever implements MemoryRetriever {
  rank(query: string, memories: Memory[], now: number, limit = 8): RankedMemory[] {
    return memories
      .filter(
        (m) =>
          (m.expiresAt === undefined || m.expiresAt > now) &&
          !(m.type === 'open_loop' && m.metadata?.status === 'completed'),
      )
      .map((memory) => {
        const keyword = overlap(query, memory.content);
        const recency = Math.exp(-Math.max(0, now - memory.createdAt) / (30 * 86400000));
        const typeBonus =
          memory.type === 'relationship' ? 0.16 : memory.type === 'open_loop' ? 0.07 : 0;
        const score =
          keyword * 0.58 +
          recency * 0.1 +
          memory.importance * 0.22 +
          Math.min(Math.log1p(memory.accessCount) / 10, 0.05) +
          typeBonus;
        return { memory, keyword, score };
      })
      .filter((r) => r.keyword > 0.04 || r.memory.type === 'relationship')
      .sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt)
      .slice(0, limit);
  }
}
