import { id, type Memory, type MemoryType } from '../domain/models';
import type { Storage } from '../storage/store';
import { overlap } from './retrieval';
export class MemoryRepository {
  constructor(private store: Storage) {}
  async list(characterId: string, now = Date.now()): Promise<Memory[]> {
    return (await this.store.list('memories', characterId, 10000)).filter(
      (m) =>
        (m.expiresAt === undefined || m.expiresAt > now) &&
        !(m.type === 'open_loop' && m.metadata?.status === 'completed'),
    );
  }
  async get(memoryId: string): Promise<Memory | undefined> {
    return this.store.get('memories', memoryId);
  }
  async upsert(
    characterId: string,
    type: MemoryType,
    content: string,
    importance: number,
    now = Date.now(),
    expiresAt?: number,
    source?: string,
  ): Promise<Memory> {
    const normalized = content.trim().slice(0, 2000);
    if (!normalized) throw new Error('记忆不能为空');
    const candidates = (await this.list(characterId, now)).filter((m) => m.type === type);
    const existing = candidates.find(
      (m) =>
        m.content.replace(/\s/g, '') === normalized.replace(/\s/g, '') ||
        overlap(m.content, normalized) >= 0.72,
    );
    const memory: Memory = existing
      ? {
          ...existing,
          content: normalized.length > existing.content.length ? normalized : existing.content,
          importance: Math.max(existing.importance, Math.max(0, Math.min(1, importance))),
          updatedAt: now,
          expiresAt:
            existing.expiresAt === undefined || expiresAt === undefined
              ? undefined
              : Math.max(existing.expiresAt, expiresAt),
        }
      : {
          id: id(),
          characterId,
          type,
          content: normalized,
          importance: Math.max(0, Math.min(1, importance)),
          createdAt: now,
          updatedAt: now,
          accessCount: 0,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
          ...(source ? { source } : {}),
        };
    await this.store.put('memories', memory);
    return memory;
  }
  async touch(memories: Memory[], now = Date.now()): Promise<void> {
    for (const memory of memories)
      await this.store.put('memories', {
        ...memory,
        lastAccessedAt: now,
        accessCount: memory.accessCount + 1,
      });
  }
  async remove(memoryId: string): Promise<void> {
    await this.store.atomic(async (tx) => {
      const memory = await tx.get('memories', memoryId);
      if (memory?.type === 'open_loop')
        for (const intention of await tx.list('intentions', memory.characterId, 10000))
          if (intention.openLoopId === memoryId)
            await tx.put('intentions', {
              ...intention,
              status: intention.status === 'pending' ? 'completed' : intention.status,
              openLoopId: undefined,
            });
      await tx.remove('memories', memoryId);
    });
  }
  async expire(characterId: string, now = Date.now()): Promise<number> {
    return this.store.atomic(async (tx) => {
      const expired = (await tx.list('memories', characterId, 10000)).filter(
        (m) => m.expiresAt !== undefined && m.expiresAt <= now,
      );
      const ids = new Set(expired.map((m) => m.id));
      for (const intention of await tx.list('intentions', characterId, 10000))
        if (intention.openLoopId && ids.has(intention.openLoopId))
          await tx.put('intentions', {
            ...intention,
            status: intention.status === 'pending' ? 'expired' : intention.status,
            openLoopId: undefined,
          });
      for (const memory of expired) await tx.remove('memories', memory.id);
      return expired.length;
    });
  }
  async completeOpenLoop(characterId: string, memoryId: string, now = Date.now()): Promise<void> {
    await this.store.atomic(async (tx) => {
      const m = await tx.get('memories', memoryId);
      if (!m || m.characterId !== characterId || m.type !== 'open_loop') return;
      await tx.put('memories', {
        ...m,
        updatedAt: now,
        metadata: { ...m.metadata, status: 'completed' },
      });
      for (const intention of await tx.list('intentions', characterId, 10000))
        if (intention.openLoopId === memoryId && intention.status === 'pending')
          await tx.put('intentions', { ...intention, status: 'completed' });
    });
  }
}
