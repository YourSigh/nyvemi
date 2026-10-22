import { z } from 'zod';
import { id, type Memory, type Message } from '../domain/models';
import type { LLMProvider } from '../providers/provider';
import type { Storage } from '../storage/store';
import { Diagnostics } from '../storage/diagnostics';
import { buildChatPrompt } from './prompt';
const ReplySchema = z.object({
  messages: z.array(z.string().trim().min(1).max(6000)).min(1).max(4),
});
export function parseReply(raw: string): string[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return ReplySchema.parse(JSON.parse(trimmed)).messages;
  } catch {
    if (trimmed && !/^[{[]/.test(trimmed) && trimmed.length <= 6000) return [trimmed];
    throw new Error('回复格式不完整，请重试本轮');
  }
}
export function streamingPreview(raw: string): string {
  if (!raw.trimStart().startsWith('{') && !raw.trimStart().startsWith('```')) return raw;
  const match = /"messages"\s*:\s*\[\s*"((?:\\.|[^"\\])*)/.exec(raw);
  if (!match) return '';
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\$/, '');
  }
}
export interface ChatHooks {
  retrieve: (characterId: string, query: string) => Promise<Memory[]>;
  afterRound: (characterId: string, user: Message, assistant: Message[]) => Promise<void>;
}
const noHooks: ChatHooks = { retrieve: async () => [], afterRound: async () => {} };
export class ChatService {
  private active = new Set<string>();
  constructor(
    private store: Storage,
    private provider: () => Promise<LLMProvider>,
    private diagnostics: Diagnostics,
    private hooks: ChatHooks = noHooks,
    private pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}
  async historyPage(
    characterId: string,
    limit = 100,
  ): Promise<{ messages: Message[]; hasMore: boolean }> {
    const raw = await this.store.list('messages', characterId, limit + 1);
    return {
      messages: raw
        .slice(0, limit)
        .filter(
          (m) =>
            (m.status !== 'pending' || m.role === 'user') &&
            !(m.origin === 'proactive' && m.status === 'error'),
        )
        .sort(
          (a, b) =>
            a.createdAt - b.createdAt ||
            Number(a.role === 'assistant') - Number(b.role === 'assistant'),
        ),
      hasMore: raw.length > limit,
    };
  }
  async history(characterId: string, limit = 100): Promise<Message[]> {
    return (await this.historyPage(characterId, limit)).messages;
  }
  async recoverInterrupted(characterId: string): Promise<void> {
    if (this.active.has(characterId)) return;
    const messages = await this.store.list('messages', characterId, 1000);
    let interrupted = false;
    for (const message of messages)
      if (message.status === 'pending' && message.origin === 'chat') {
        await this.store.put('messages', {
          ...message,
          status: message.role === 'user' ? 'error' : 'complete',
        });
        if (message.role === 'user') interrupted = true;
      }
    if (interrupted) await this.store.release(`chat:${characterId}`);
    const groups = new Map<string, Message[]>();
    for (const message of messages)
      if (message.role === 'assistant' && message.origin === 'chat' && message.groupId) {
        const group = groups.get(message.groupId) ?? [];
        group.push({ ...message, status: 'complete' });
        groups.set(message.groupId, group);
      }
    for (const [userId, assistant] of groups) {
      const user = await this.store.get('messages', userId);
      if (user?.status === 'complete')
        await this.hooks.afterRound(
          characterId,
          user,
          assistant.sort((a, b) => a.createdAt - b.createdAt),
        );
    }
  }
  async send(
    characterId: string,
    text: string,
    onPreview: (text: string) => void,
    onSaved: () => void = () => {},
    signal?: AbortSignal,
    retryId?: string,
  ): Promise<void> {
    const content = text.trim();
    if (!content || content.length > 6000) throw new Error('请输入 1～6000 字消息');
    const lease = `chat:${characterId}`;
    if (!(await this.store.lease(lease, Date.now(), 180000)))
      throw new Error('这一轮还没聊完，请稍候');
    this.active.add(characterId);
    let user: Message | undefined;
    let hasReply = false;
    try {
      const character = await this.store.get('characters', characterId);
      if (!character) throw new Error('角色不存在');
      const settings = await this.store.get('settings', characterId);
      if (settings) await this.store.put('settings', { ...settings, lastActiveAt: Date.now() });
      const retry = retryId ? await this.store.get('messages', retryId) : undefined;
      if (
        retryId &&
        (!retry ||
          retry.characterId !== characterId ||
          retry.role !== 'user' ||
          retry.status !== 'error')
      )
        throw new Error('这条消息不能重试');
      user = retry;
      user = user
        ? { ...user, status: 'pending' }
        : {
            id: id(),
            characterId,
            role: 'user',
            content,
            createdAt: Date.now(),
            origin: 'chat',
            status: 'pending',
          };
      await this.store.put('messages', user);
      onSaved();
      const history = (await this.history(characterId)).filter(
        (m) => m.status === 'complete' && m.id !== user!.id,
      );
      // A retry may be older than the history window: always include this request last.
      history.push({ ...user, status: 'complete' });
      const memories = await this.hooks.retrieve(characterId, content);
      const prompt = buildChatPrompt(character, history, memories);
      if (settings?.developerMode)
        await this.diagnostics.record('prompt', characterId, { purpose: 'chat', messages: prompt });
      let raw = '';
      const result = await (
        await this.provider()
      ).streamChat(
        prompt,
        (delta) => {
          raw += delta;
          onPreview(streamingPreview(raw));
        },
        signal,
      );
      const replies = parseReply(result.content);
      const saved: Message[] = [];
      const base = Date.now();
      const group: Message[] = replies.map((content, n) => ({
        id: id(),
        characterId,
        role: 'assistant',
        content,
        createdAt: base + n,
        origin: 'chat',
        status: 'pending',
        groupId: user!.id,
      }));
      user = { ...user, status: 'complete' };
      await this.store.atomic(async (tx) => {
        await tx.put('messages', user!);
        for (const message of group) await tx.put('messages', message);
      });
      hasReply = true;
      for (let n = 0; n < group.length; n++) {
        if (n > 0) await this.pause(400 + Math.floor(Math.random() * 600));
        const message: Message = { ...group[n], status: 'complete' };
        await this.store.put('messages', message);
        saved.push(message);
        onPreview('');
        onSaved();
      }
      // Hooks persist their durable work before returning; actual extraction does not block the composer.
      try {
        await this.hooks.afterRound(characterId, user, saved);
      } catch {
        await this.diagnostics.error(characterId, 'post_round');
      }
    } catch (error) {
      if (user && !hasReply) await this.store.put('messages', { ...user, status: 'error' });
      onPreview('');
      onSaved();
      await this.diagnostics.error(characterId, 'chat');
      throw error;
    } finally {
      this.active.delete(characterId);
      await this.store.release(lease);
    }
  }
}
