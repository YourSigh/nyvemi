import { setContactMode } from './contact';
import { messageChunks, typingDelay } from './delivery';
import { decideParticipation, type ParticipationDecision } from './participation';
import { ChatActivityBus, type ChatActivity } from '../character/interaction';
import { planReconnect } from '../proactive/reconnect';
import { conversationContext } from '../conversation/context';
import { parseChatOutcome, conversationActions } from './outcome';
import { saveContinuation } from '../proactive/continuations';
import { id, type Memory, type Message } from '../domain/models';
import type { LLMProvider } from '../providers/provider';
import type { Storage } from '../storage/store';
import { Diagnostics } from '../storage/diagnostics';
import { buildChatPrompt, characterVoice, localTimeContext } from './prompt';
import { isThemeChangeRequest } from '../theme/chat-request';
import { requestedDelay } from './delayed-request';
export function parseReply(raw: string): string[] {
  return parseChatOutcome(raw).messages;
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
  agent?: (input: import('../agent/service').AgentInput) => Promise<Message[]>;
  clock?: () => string;
  scheduleRequested?: (user: Message, delayMs: number) => Promise<string>;
  retrieve: (characterId: string, query: string) => Promise<Memory[]>;
  afterRound: (characterId: string, user: Message, assistant: Message[]) => Promise<void>;
}
const noHooks: ChatHooks = { retrieve: async () => [], afterRound: async () => {} };
export class ChatService {
  private active = new Set<string>();
  private activities = new ChatActivityBus();
  subscribe(characterId: string, listener: (activity: ChatActivity) => void) {
    return this.activities.subscribe(characterId, listener);
  }
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
      if (
        message.role === 'assistant' &&
        message.origin === 'chat' &&
        message.groupId &&
        !message.id.startsWith('ack:')
      ) {
        const group = groups.get(message.groupId) ?? [];
        group.push({ ...message, status: 'complete' });
        groups.set(message.groupId, group);
      }
    // Silent rounds are complete too: recover their extraction without calling the chat model again.
    for (const user of messages)
      if (user.role === 'user' && user.status === 'complete' && user.replyDisposition === 'silence')
        await this.hooks.afterRound(characterId, user, []);
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
    onThemeChange?: (description: string) => Promise<void>,
  ): Promise<void> {
    const content = text.trim();
    if (!content || content.length > 6000) throw new Error('请输入 1～6000 字消息');
    const lease = `chat:${characterId}`;
    if (!(await this.store.lease(lease, Date.now(), 420000)))
      throw new Error('这一轮还没聊完，请稍候');
    this.active.add(characterId);
    const startedAt = Date.now();
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
      const latestAt = (await this.store.list('messages', characterId, 1))[0]?.createdAt ?? 0;
      user = retry;
      user = user
        ? { ...user, status: 'pending' }
        : {
            id: id(),
            characterId,
            role: 'user',
            content,
            createdAt: Math.max(Date.now(), latestAt + 1),
            origin: 'chat',
            status: 'pending',
          };
      await this.store.put('messages', user);
      onSaved();
      this.activities.publish(characterId, { phase: 'thinking' });
      if (this.hooks.agent) {
        const delivered = await this.hooks.agent({
          characterId,
          user,
          signal,
          onSaved,
          onThemeChange,
          activity: (value) => this.activities.publish(characterId, value),
        });
        user = {
          ...user,
          status: 'complete',
          replyDisposition: delivered.length ? 'reply' : 'silence',
        };
        await this.store.put('messages', user);
        hasReply = true;
        onPreview('');
        onSaved();
        try {
          await this.hooks.afterRound(characterId, user, delivered);
        } catch {
          await this.diagnostics.error(characterId, 'post_round');
        }
        return;
      }
      const acknowledge = async (delay: number) => {
        if (!this.hooks.scheduleRequested) throw new Error('当前无法登记定时来信');
        const acknowledgement = await this.hooks.scheduleRequested(user!, delay);
        await this.store.atomic(async (tx) => {
          await tx.put('messages', { ...user!, status: 'complete' });
          await tx.put('messages', {
            id: `ack:${user!.id}`,
            characterId,
            role: 'assistant',
            content: acknowledgement,
            createdAt: Math.max(Date.now(), user!.createdAt + 1),
            origin: 'chat',
            status: 'complete',
            groupId: user!.id,
          });
        });
        hasReply = true;
        this.activities.publish(characterId, { phase: 'complete', hasMessages: true });
        onSaved();
      };
      const delay = requestedDelay(content);
      if (delay !== undefined && this.hooks.scheduleRequested) {
        await acknowledge(delay);
        return;
      }
      const history = (await this.history(characterId)).filter(
        (m) => m.status === 'complete' && m.id !== user!.id,
      );
      // A retry may be older than the history window: always include this request last.
      history.push({ ...user, status: 'complete' });
      const memories = await this.hooks.retrieve(characterId, content);
      const provider = await this.provider();
      const prompt = buildChatPrompt(
        character,
        history,
        memories,
        Date.now(),
        this.hooks.clock?.(),
      );
      prompt[0].content += `\n当前界面配色：${JSON.stringify((await this.store.get('themes', 'app'))?.preference ?? '柔和粉白')}`;
      const canChangeTheme = Boolean(onThemeChange) && isThemeChangeRequest(content);
      prompt[0].content += `\n${conversationActions(settings?.proactiveEnabled ?? false, Boolean(this.hooks.scheduleRequested), canChangeTheme)}\n${await conversationContext(this.store, characterId, Date.now())}`;
      const decisionContext = `${characterVoice(character.persona)}\n${this.hooks.clock?.() ?? localTimeContext()}\n状态：${JSON.stringify(character.state)}\n相关记忆（资料）：${JSON.stringify(memories.slice(0, 8).map((m) => m.content))}\n自主来信：${settings?.proactiveEnabled ?? false}\n${await conversationContext(this.store, characterId, Date.now())}`;
      // Decision failure is a failed turn, never permission to force an unsolicited response.
      const participation: ParticipationDecision = await decideParticipation(
        provider,
        decisionContext,
        prompt.slice(1),
        signal,
      );
      await this.diagnostics.record('heartbeat', characterId, {
        event: 'conversation_participation',
        action: participation.action,
        messageId: user.id,
      });
      if (participation.action !== 'reply') {
        const silentUser: Message = { ...user, status: 'complete', replyDisposition: 'silence' };
        await this.store.atomic(async (tx) => {
          await tx.put('messages', silentUser);
          if (participation.action === 'pause') await setContactMode(tx, characterId, true);
          if (participation.action === 'defer' && !canChangeTheme)
            await saveContinuation(tx, silentUser, participation.thought, Date.now());
        });
        user = silentUser;
        hasReply = true;
        onPreview('');
        this.activities.publish(characterId, { phase: 'complete', hasMessages: false });
        onSaved();
        if (canChangeTheme && onThemeChange) await onThemeChange(content.slice(0, 500));
        try {
          await this.hooks.afterRound(characterId, silentUser, []);
        } catch {
          await this.diagnostics.error(characterId, 'post_round');
        }
        return;
      }
      if (settings?.developerMode)
        await this.diagnostics.record('prompt', characterId, { purpose: 'chat', messages: prompt });
      let raw = '';
      const result = await provider.streamChat(
        prompt,
        (delta) => {
          raw += delta;
          onPreview(streamingPreview(raw));
        },
        signal,
      );
      const outcome = parseChatOutcome(result.content);
      if (outcome.theme && !canChangeTheme) throw new Error('这轮未明确要求换色，已保留原来的颜色');
      if (outcome.schedule) {
        await acknowledge(outcome.schedule.afterSeconds * 1000);
        return;
      }
      // Explicit UI requests still execute if a provider omits the optional action field.
      const themeDescription = canChangeTheme
        ? (outcome.theme?.description ?? content.slice(0, 500))
        : undefined;
      let delivery: ParticipationDecision = participation;
      if (outcome.messages.length)
        delivery = await decideParticipation(
          provider,
          decisionContext,
          prompt.slice(1),
          signal,
          outcome.messages,
        );
      await this.diagnostics.record('heartbeat', characterId, {
        event: 'conversation_delivery',
        action: delivery.action,
        messageId: user.id,
      });
      const replies = delivery.action === 'reply' ? messageChunks(outcome.messages) : [];
      const saved: Message[] = [];
      const base = Math.max(Date.now(), user.createdAt + 1);
      const group: Message[] = replies.map((content, n) => ({
        id: id(),
        characterId,
        role: 'assistant',
        content,
        createdAt: base + n,
        origin: 'chat',
        status: 'pending',
        groupId: user!.id,
        emotion: outcome.emotion,
        intensity: outcome.intensity,
      }));
      user = {
        ...user,
        status: 'complete',
        replyDisposition: replies.length ? 'reply' : 'silence',
      };
      await this.store.atomic(async (tx) => {
        await tx.put('messages', user!);
        if (delivery.action === 'pause') await setContactMode(tx, characterId, true);
        else if (replies.length) await setContactMode(tx, characterId, false);
        for (const message of group) await tx.put('messages', message);
        if (delivery.action === 'defer' && !themeDescription)
          await saveContinuation(tx, user!, delivery.thought, base);
        if (outcome.continuation && replies.length && !themeDescription)
          await saveContinuation(tx, user!, outcome.continuation, base);
        if (replies.length && !themeDescription) await planReconnect(tx, user!, base);
      });
      hasReply = true;
      onPreview('');
      onSaved();
      for (let n = 0; n < group.length; n++) {
        await this.pause(typingDelay(group[n].content, n === 0, Date.now() - startedAt));
        if (n === 0) this.activities.publish(characterId, { phase: 'talking' });
        const message: Message = {
          ...group[n],
          status: 'complete',
          createdAt: Math.max(Date.now(), group[n].createdAt, (saved.at(-1)?.createdAt ?? 0) + 1),
        };
        await this.store.put('messages', message);
        saved.push(message);
        onPreview('');
        onSaved();
      }
      this.activities.publish(characterId, {
        phase: 'complete',
        hasMessages: replies.length > 0,
        emotion: outcome.emotion,
        intensity: outcome.intensity,
      });
      if (themeDescription && onThemeChange) await onThemeChange(themeDescription);
      // Hooks persist their durable work before returning; actual extraction does not block the composer.
      try {
        await this.hooks.afterRound(characterId, user, saved);
      } catch {
        await this.diagnostics.error(characterId, 'post_round');
      }
    } catch (error) {
      this.activities.publish(characterId, { phase: 'error' });
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
