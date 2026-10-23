import { z } from 'zod';
import { id, type Message } from '../domain/models';
import type { LLMProvider } from '../providers/provider';
import type { Storage } from '../storage/store';
import { Diagnostics } from '../storage/diagnostics';
import { MemoryRepository } from './repository';
import { overlap } from './retrieval';
const fact = z.object({
  content: z.string().min(1).max(2000),
  importance: z.number().min(0).max(1),
  expiresInDays: z.number().min(1).max(3650).nullable(),
});
export const ExtractionSchema = z
  .object({
    memories: z.array(fact.extend({ type: z.enum(['semantic', 'episodic']) })).max(8),
    openLoops: z
      .array(
        z.object({
          topic: z.string().min(1).max(300),
          reason: z.string().max(500),
          importance: z.number().min(0).max(1),
          earliestInMinutes: z.number().min(15).max(10080),
          latestInMinutes: z.number().min(30).max(43200),
        }),
      )
      .max(4),
    relationshipUpdates: z.array(fact).max(5),
    personaFeedback: z.array(z.string().max(500)).max(5),
    completedOpenLoopIds: z.array(z.string()).max(10),
    proactivityPreference: z.enum(['pause', 'unchanged']).optional(),
  })
  .strict();
export type Extraction = z.infer<typeof ExtractionSchema>;
export class MemoryExtractionService {
  private running = false;
  constructor(
    private store: Storage,
    private provider: () => Promise<LLMProvider>,
    private diagnostics: Diagnostics,
  ) {}
  async enqueue(characterId: string, user: Message, assistant: Message[]): Promise<void> {
    if (user.content.trim().length < 4 || (await this.store.get('extractions', user.id))) return;
    await this.store.put('extractions', {
      id: user.id,
      characterId,
      userMessageId: user.id,
      assistantMessageIds: assistant.map((m) => m.id),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
    });
  }
  async drain(now = Date.now(), limit = 2): Promise<void> {
    if (this.running) return;
    this.running = true;
    const lease = 'memory-extraction';
    let acquired = false;
    try {
      acquired = await this.store.lease(lease, now, 240000);
      if (!acquired) return;
      const jobs = (await this.store.list('extractions', undefined, 10000))
        .filter((j) => j.status === 'pending' && j.nextAttemptAt <= now)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, limit);
      for (const job of jobs) {
        try {
          const user = await this.store.get('messages', job.userMessageId);
          const assistant = (
            await Promise.all(job.assistantMessageIds.map((mid) => this.store.get('messages', mid)))
          ).filter((m): m is Message => Boolean(m));
          if (!user) {
            await this.store.put('extractions', { ...job, status: 'failed' });
            continue;
          }
          const loops = (await new MemoryRepository(this.store).list(job.characterId, now))
            .filter((m) => m.type === 'open_loop')
            .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
            .slice(0, 20);
          const previousAssistant = (await this.store.list('messages', job.characterId, 20))
            .filter(
              (m) =>
                m.role === 'assistant' && m.status === 'complete' && m.createdAt < user.createdAt,
            )
            .slice(0, 2)
            .map((m) => m.content.slice(0, 1000));
          const result = await (
            await this.provider()
          ).structuredOutput(
            [
              {
                role: 'system',
                content: `提取有长期价值的事实、共同事件、用户对说话方式的反馈、以后值得问的事。不要把寒暄存为记忆；不要捏造用户未说的事实。importance 在 0..1。用户对说话方式的明确喜恶必须写入 relationshipUpdates，personaFeedback 同时写简短可执行的表达偏好。relationshipUpdates 的每项与 memories 的事实结构一致：content 字符串、importance 数字、expiresInDays 为数字或 null，不使用 preference/direction 等其它字段。只有用户明确说明事情已结束或要求停止跟进，才完成已有 open loop，不能因为助手问过就完成。用户明确要求不要主动联系时，proactivityPreference 设为 pause；只是反感模板或结尾提问时设为 unchanged。不要自行恢复主动联系。只输出 JSON，示例：{"memories":[{"type":"semantic","content":"用户做 Android 开发","importance":0.7,"expiresInDays":null}],"openLoops":[{"topic":"下午的会议","reason":"用户可能愿意分享结果","importance":0.72,"earliestInMinutes":180,"latestInMinutes":720}],"relationshipUpdates":[{"content":"用户讨厌助手每句结尾问要不要继续","importance":0.9,"expiresInDays":null}],"personaFeedback":["不要每句以要不要继续结尾"],"completedOpenLoopIds":[]}。无相应信息则空数组。open loop 只记录未来值得问的时间窗口，不预先生成发送文案。当前时间 ${new Date(now).toISOString()}。已有未完成事件：${JSON.stringify(loops.map((m) => ({ id: m.id, content: m.content })))}`,
              },
              {
                role: 'user',
                content: JSON.stringify({
                  user: user.content,
                  previousAssistant,
                  assistant: assistant.map((m) => m.content),
                }),
              },
            ],
            ExtractionSchema,
            'memory_extraction',
          );
          await this.apply(job.characterId, result, now, job.id);
          await this.store.put('extractions', {
            ...job,
            status: 'done',
            attempts: job.attempts + 1,
          });
        } catch {
          const attempts = job.attempts + 1;
          await this.store.put('extractions', {
            ...job,
            attempts,
            status: attempts >= 5 ? 'failed' : 'pending',
            nextAttemptAt: now + Math.min(24 * 60, 15 * 2 ** attempts) * 60000,
          });
          await this.diagnostics.error(job.characterId, 'memory_extraction');
        }
      }
    } finally {
      if (acquired) await this.store.release(lease);
      this.running = false;
    }
  }
  async apply(characterId: string, result: Extraction, now: number, source: string): Promise<void> {
    const validated = ExtractionSchema.parse(result);
    await this.store.atomic(async (tx) => {
      const job = await tx.get('extractions', source);
      if (job?.status === 'done') return;
      const repo = new MemoryRepository(tx);
      for (const item of validated.memories)
        if (item.importance >= 0.35)
          await repo.upsert(
            characterId,
            item.type,
            item.content,
            item.importance,
            now,
            item.expiresInDays === null ? undefined : now + item.expiresInDays * 86400000,
            source,
          );
      for (const item of validated.relationshipUpdates)
        await repo.upsert(
          characterId,
          'relationship',
          item.content,
          Math.max(0.6, item.importance),
          now,
          item.expiresInDays === null ? undefined : now + item.expiresInDays * 86400000,
          source,
        );
      // Expression feedback is relationship knowledge even if the model only fills personaFeedback.
      for (const feedback of validated.personaFeedback)
        if (feedback.trim() && !validated.relationshipUpdates.length)
          await repo.upsert(characterId, 'relationship', feedback, 0.75, now, undefined, source);
      for (const loop of validated.openLoops) {
        if (loop.importance < 0.5 || loop.latestInMinutes <= loop.earliestInMinutes) continue;
        const active = await tx.list('intentions', characterId, 10000);
        if (
          active.some(
            (i) =>
              i.status === 'pending' && i.latestAt > now && overlap(i.topic, loop.topic) >= 0.7,
          )
        )
          continue;
        const memory = await repo.upsert(
          characterId,
          'open_loop',
          loop.topic,
          loop.importance,
          now,
          now + loop.latestInMinutes * 60000,
          source,
        );
        await tx.put('memories', { ...memory, metadata: { ...memory.metadata, status: 'open' } });
        await tx.put('intentions', {
          id: id(),
          characterId,
          type: 'follow_up',
          topic: loop.topic,
          reason: loop.reason,
          importance: loop.importance,
          earliestAt: now + loop.earliestInMinutes * 60000,
          latestAt: now + loop.latestInMinutes * 60000,
          status: 'pending',
          openLoopId: memory.id,
          createdAt: now,
        });
      }
      for (const memoryId of validated.completedOpenLoopIds) {
        const m = await tx.get('memories', memoryId);
        if (m?.characterId !== characterId || m.type !== 'open_loop') continue;
        await tx.put('memories', {
          ...m,
          updatedAt: now,
          metadata: { ...m.metadata, status: 'completed' },
        });
        for (const intention of await tx.list('intentions', characterId, 10000))
          if (intention.openLoopId === memoryId && intention.status === 'pending')
            await tx.put('intentions', { ...intention, status: 'completed' });
      }
      if (job) await tx.put('extractions', { ...job, status: 'done', attempts: job.attempts + 1 });
      if (validated.proactivityPreference === 'pause') {
        const settings = await tx.get('settings', characterId);
        if (settings) await tx.put('settings', { ...settings, proactiveEnabled: false });
      }
      const character = await tx.get('characters', characterId);
      if (character) {
        const prefs = [
          ...new Set([...character.persona.responsePreferences, ...validated.personaFeedback]),
        ].slice(-24);
        await tx.put('characters', {
          ...character,
          persona: { ...character.persona, responsePreferences: prefs },
          state: {
            ...character.state,
            recentFocus: [
              ...new Set([
                ...validated.openLoops
                  .filter((l) => l.importance >= 0.5)
                  .map((l) => l.topic.slice(0, 80)),
                ...validated.memories
                  .filter((m) => m.type === 'episodic' && m.importance >= 0.6)
                  .map((m) => m.content.slice(0, 80)),
                ...character.state.recentFocus,
              ]),
            ].slice(0, 4),
            relationshipCloseness: Math.min(0.9, character.state.relationshipCloseness + 0.005),
          },
        });
      }
    });
  }
}
