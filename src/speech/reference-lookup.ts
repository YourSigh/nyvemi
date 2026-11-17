import type { VoiceReferenceCandidate } from '../native/android';
export type ReferenceLookupResult = { candidates: VoiceReferenceCandidate[]; error?: string };
/** Scoped to one runtime; a remount reads results rather than re-issuing searches. */
export function createReferenceLookup(find: (query: string) => Promise<VoiceReferenceCandidate[]>) {
  const results = new Map<string, ReferenceLookupResult>();
  const pending = new Map<string, Promise<ReferenceLookupResult>>();
  const key = (cid: string, query: string) => JSON.stringify([cid, query]);
  return {
    peek(cid: string, query: string) {
      return results.get(key(cid, query));
    },
    async find(cid: string, query: string) {
      const k = key(cid, query),
        old = pending.get(k);
      if (old) return old;
      const request = (async (): Promise<ReferenceLookupResult> => {
        try {
          const candidates = await find(query);
          const result = {
            candidates: candidates
              .filter((c) => c.language === 'zh' && c.usage === 'preview')
              .slice(0, 8),
          };
          results.set(k, result);
          return result;
        } catch {
          const result = {
            candidates: [],
            error: '没有找到可读取的同角色中文参考录音，原声未改变。可以重试或导入有权使用的 WAV。',
          };
          results.set(k, result);
          return result;
        } finally {
          pending.delete(k);
        }
      })();
      pending.set(k, request);
      return request;
    },
  };
}
