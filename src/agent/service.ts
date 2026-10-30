import { z } from 'zod';
import {
  AppraisalSchema,
  id,
  type Intention,
  type Message,
  type NotificationRecord,
} from '../domain/models';
import type { LLMProvider } from '../providers/provider';
import type { Storage } from '../storage/store';
import type { Diagnostics } from '../storage/diagnostics';
import type { ChatActivity } from '../character/interaction';
import type { NotificationGateway } from '../proactive/heartbeat/engine';
import { MemoryRecall } from '../memory/recall';
import { conversationContext } from '../conversation/context';
import { setContactMode } from '../chat/contact';
import { messageChunks, typingDelay } from '../chat/delivery';
import { ExperienceEngine } from '../experience/engine';
import { agentSystem } from './prompt';
import { agentTools } from './tools';
import { runEmbeddedAgent, type AgentRunner } from './core';
import type { AgentSession } from './model';
import type { AgentWeb, WebDocument } from './web';
export interface AgentHost {
  web: AgentWeb;
  notifications: NotificationGateway;
  visible(): boolean;
  clock(): string;
  model(): Promise<string>;
  schedule(task: Intention): Promise<void>;
  redact(value: unknown): Promise<unknown>;
  pause?(ms: number): Promise<void>;
}
export interface AgentInput {
  characterId: string;
  user?: Message;
  task?: Intention;
  signal?: AbortSignal;
  onSaved?: () => void;
  activity?: (value: ChatActivity) => void;
  onThemeChange?: (description: string) => Promise<void>;
}
export class CompanionAgent {
  constructor(
    private store: Storage,
    private provider: () => Promise<LLMProvider>,
    private diagnostics: Diagnostics,
    private host: AgentHost,
    private runner: AgentRunner = runEmbeddedAgent,
  ) {}
  async run(input: AgentInput): Promise<Message[]> {
    const cid = input.characterId,
      now = Date.now();
    if (!(await this.store.lease('agent-runtime', now, 240000)))
      throw new Error('她还在处理上一件事，请稍候');
    let session: AgentSession | undefined;
    const saved: Message[] = [];
    const groupId = input.user?.id ?? input.task?.id ?? `explore:${id()}`;
    let bubbleCount = 0;
    try {
      const character = await this.store.get('characters', cid);
      if (!character) throw new Error('角色不存在');
      const prior = await this.store.get('agentSessions', cid);
      const rollover = prior && JSON.stringify(prior.events).length > 180000;
      session =
        prior && !rollover
          ? { ...prior }
          : {
              id: cid,
              characterId: cid,
              sessionId: `dsh:${id()}`,
              version: 1,
              events: [],
              createdAt: now,
              updatedAt: now,
              nextExploreAt: prior?.nextExploreAt,
            };
      session.lastInputId = groupId;
      session.lastRunStatus = 'running';
      const checkpoint = async (events: unknown[]) => {
        if (!(await this.store.get('characters', cid))) throw new Error('角色已清空');
        session = {
          ...session!,
          events: (await this.host.redact(events)) as unknown[],
          updatedAt: Date.now(),
        };
        await this.store.put('agentSessions', session);
      };
      const provider = await this.provider();
      if (!provider.toolChat) throw new Error('当前 Provider 不支持 Agent 工具调用');
      const history = (await this.store.list('messages', cid, 20))
        .filter((m) => m.status === 'complete' && m.id !== input.user?.id)
        .reverse();
      const memories = await new MemoryRecall(this.store, this.diagnostics).retrieve(
        cid,
        input.user?.content ??
          input.task?.topic ??
          character.interests.map((i) => i.topic).join(' '),
      );
      const text = input.user
        ? JSON.stringify({
            event: 'user_message',
            id: input.user.id,
            at: new Date(input.user.createdAt).toISOString(),
            text: input.user.content,
          })
        : JSON.stringify({
            event: input.task ? 'wakeup' : 'free_time',
            at: new Date(now).toISOString(),
            reason: input.task?.reason ?? '有空逛一会儿，按你自己的兴趣选择，也可以什么都不做',
            task: input.task,
            userSentNewMessage: false,
          });
      const assertCurrent = async () => {
        if (input.signal?.aborted) throw new Error('已取消');
        if (!(await this.store.get('characters', cid))) throw new Error('角色已清空');
        if (input.task && (await this.store.get('intentions', input.task.id))?.status !== 'pending')
          throw new Error('安排已取消');
      };
      const evidence = async (docs: WebDocument[]) => {
        const result = [];
        for (const doc of docs) {
          const existing = (await this.store.list('agentEvidence', cid, 200)).find(
            (d) => d.url === doc.url && d.source === doc.source && d.expiresAt > Date.now(),
          );
          const row = existing ?? {
            id: id(),
            characterId: cid,
            ...doc,
            createdAt: Date.now(),
            expiresAt: Date.now() + 4 * 3600000,
          };
          await this.store.put('agentEvidence', row);
          result.push({ evidenceId: row.id, ...doc });
        }
        const rows = await this.store.list('agentEvidence', cid, 1000);
        for (const row of rows.slice(80)) await this.store.remove('agentEvidence', row.id);
        return result;
      };
      input.activity?.({ phase: 'thinking' });
      await this.runner(
        {
          id: session.sessionId,
          model: await this.host.model(),
          system: agentSystem(
            character,
            memories,
            history,
            this.host.clock(),
            await conversationContext(this.store, cid, now),
          ),
          text,
          seed: session.events,
          maxSteps: 8,
          timeoutMs: 180000,
          tools: agentTools.filter((t) => t.name !== 'change_theme' || input.onThemeChange),
        },
        {
          signal: input.signal,
          checkpoint,
          generate: async (request, signal) => {
            await assertCurrent();
            return provider.toolChat!(request, signal);
          },
          execute: async (name, raw, execution) => {
            await assertCurrent();
            const args = z.record(z.unknown()).parse(raw);
            const log = async (success: boolean) =>
              this.diagnostics.record('heartbeat', cid, {
                event: 'agent_tool',
                name,
                callId: execution.callId,
                success,
                trigger: input.user ? 'user' : input.task ? 'wakeup' : 'free_time',
              });
            try {
              let result: unknown;
              if (name === 'send_message') {
                const parsed = z
                  .object({
                    messages: z.array(z.string().trim().min(1).max(1200)).min(1).max(4),
                    emotion: z
                      .enum([
                        'amused',
                        'curious',
                        'excited',
                        'annoyed',
                        'embarrassed',
                        'sad',
                        'calm',
                        'tired',
                      ])
                      .optional(),
                  })
                  .parse(args);
                const contents = messageChunks(parsed.messages);
                if (bubbleCount + contents.length > 6)
                  throw new Error('这一轮已经发了几条，先停一停');
                const messages: Message[] = [];
                for (const [n, content] of contents.entries()) {
                  await assertCurrent();
                  const mid = `${session!.sessionId}:${execution.callId}:${n}`;
                  const old = await this.store.get('messages', mid);
                  if (old?.status === 'complete') {
                    messages.push(old);
                    continue;
                  }
                  if (this.host.visible())
                    await (
                      this.host.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
                    )(typingDelay(content, bubbleCount === 0, Date.now() - now));
                  await assertCurrent();
                  const message: Message = {
                    id: mid,
                    characterId: cid,
                    role: 'assistant',
                    content,
                    emotion: parsed.emotion,
                    createdAt: Date.now() + n,
                    origin: input.user ? 'chat' : 'proactive',
                    status: 'complete',
                    groupId,
                  };
                  await this.store.put('messages', message);
                  if (input.user) await setContactMode(this.store, cid, false);
                  saved.push(message);
                  messages.push(message);
                  bubbleCount++;
                  input.activity?.({ phase: 'talking' });
                  input.onSaved?.();
                }
                if (!input.user || !this.host.visible())
                  await this.queueNotification(input, groupId, saved);
                result = { sent: messages.map((m) => m.id) };
              } else if (name === 'wait') {
                const parsed = z
                  .object({ untilUser: z.boolean(), reason: z.string().max(300) })
                  .parse(args);
                if (parsed.untilUser) await setContactMode(this.store, cid, true);
                result = { waiting: true, contact: parsed.untilUser ? 'quiet' : 'unchanged' };
              } else if (name === 'schedule_wakeup') {
                const parsed = z
                  .object({
                    afterSeconds: z
                      .number()
                      .int()
                      .min(30)
                      .max(7 * 86400),
                    reason: z.string().trim().min(1).max(500),
                    requested: z.boolean(),
                  })
                  .parse(args);
                const settings = await this.store.get('settings', cid);
                if (!parsed.requested && !settings?.proactiveEnabled)
                  throw new Error('自主来信未开启');
                if (parsed.requested && !input.user) throw new Error('这次没有用户的新约定');
                const task: Intention = {
                  id: `${session!.sessionId}:${execution.callId}`,
                  characterId: cid,
                  agentWakeup: true,
                  type: parsed.requested ? 'requested' : 'continuation',
                  sourceMessageId: input.user?.id,
                  topic: parsed.reason,
                  reason: parsed.reason,
                  importance: 0.7,
                  earliestAt: Date.now() + parsed.afterSeconds * 1000,
                  latestAt: Date.now() + parsed.afterSeconds * 1000 + 6 * 3600000,
                  createdAt: Date.now(),
                  status: 'pending',
                };
                if (!(await this.host.notifications.enabled())) throw new Error('请先允许角色通知');
                await this.store.put('intentions', task);
                try {
                  await this.host.schedule(task);
                } catch {
                  await this.store.put('intentions', { ...task, status: 'cancelled' });
                  throw new Error('系统没有登记唤醒，尚未安排成功');
                }
                result = {
                  scheduled: true,
                  id: task.id,
                  earliestAt: task.earliestAt,
                  approximate: true,
                };
              } else if (name === 'recall_memory') {
                const query = z.string().min(1).max(500).parse(args.query);
                result = (
                  await new MemoryRecall(this.store, this.diagnostics).retrieve(cid, query)
                ).map((m) => ({ type: m.type, content: m.content }));
              } else if (name === 'read_context') {
                result = {
                  time: this.host.clock(),
                  conversation: await conversationContext(this.store, cid, Date.now()),
                  experiences: (await this.store.list('experiences', cid, 6)).map((e) => ({
                    title: e.title,
                    content: e.content,
                    appraisal: e.appraisal,
                    url: e.url,
                  })),
                };
              } else if (name === 'web_search') {
                result = await evidence(
                  await this.host.web.search(
                    z.string().min(1).max(200).parse(args.query),
                    execution.signal,
                  ),
                );
              } else if (name === 'web_fetch') {
                const url = z.string().url().max(2000).parse(args.url);
                const cached = (await this.store.list('agentEvidence', cid, 100)).find(
                  (d) => d.url === url && d.source === 'web-page' && d.expiresAt > Date.now(),
                );
                result = cached
                  ? [{ evidenceId: cached.id, ...cached }]
                  : await evidence([await this.host.web.read(url, execution.signal)]);
              } else if (name === 'browse_bilibili') {
                result = await evidence(
                  await this.host.web.bilibili(
                    z.string().min(1).max(200).parse(args.query),
                    execution.signal,
                  ),
                );
              } else if (name === 'remember_experience') {
                const parsed = z
                  .object({
                    evidenceId: z.string(),
                    impression: z.string().min(1).max(800),
                    topics: z.array(z.string().min(1).max(40)).max(5),
                    appraisal: AppraisalSchema,
                  })
                  .parse(args);
                const doc = await this.store.get('agentEvidence', parsed.evidenceId);
                if (!doc || doc.characterId !== cid || doc.expiresAt < Date.now())
                  throw new Error('需要先读到有效的网页证据');
                const source = doc.source.startsWith('mock')
                  ? 'mock-bilibili'
                  : doc.source.startsWith('bilibili')
                    ? 'bilibili'
                    : 'agent-web';
                await new ExperienceEngine(this.store).ingest(
                  character,
                  [
                    {
                      id: source,
                      fetch: async () => [
                        {
                          id: `agent-exp:${doc.id}`,
                          characterId: cid,
                          source,
                          externalId: doc.url,
                          title: doc.title,
                          content: `来源范围：${doc.source}。${doc.text.slice(0, 2500)}\n自己的反应：${parsed.impression}`,
                          url: doc.url,
                          topics: parsed.topics,
                          appraisal: parsed.appraisal,
                          createdAt: Date.now(),
                        },
                      ],
                    },
                  ],
                  Date.now(),
                  async () => {},
                  (item) => item.appraisal!,
                );
                result = { remembered: true, evidenceId: doc.id };
              } else if (name === 'change_theme' && input.onThemeChange) {
                await input.onThemeChange(z.string().min(1).max(500).parse(args.description));
                result = { applied: true };
              } else throw new Error('没有这个工具');
              await log(true);
              return (await this.host.redact(result)) ?? null;
            } catch {
              await log(false);
              throw new Error('工具执行失败，操作未确认；请换一种方式或保持安静，不要编造成功。');
            }
          },
        },
      );
      session = { ...session!, lastRunStatus: 'complete', updatedAt: Date.now() };
      await this.store.put('agentSessions', session);
      if (input.task) await this.store.put('intentions', { ...input.task, status: 'completed' });
      await this.flushOutbox(cid);
      input.activity?.({
        phase: 'complete',
        hasMessages: saved.length > 0,
        emotion: saved.at(-1)?.emotion,
      });
      return saved;
    } catch (error) {
      if (session)
        await this.store.put('agentSessions', {
          ...session,
          lastRunStatus: 'error',
          updatedAt: Date.now(),
        });
      await this.flushOutbox(cid).catch(() => undefined);
      await this.diagnostics.error(cid, 'agent_run');
      if (saved.length) return saved;
      throw error;
    } finally {
      await this.store.release('agent-runtime');
    }
  }
  private async queueNotification(input: AgentInput, groupId: string, messages: Message[]) {
    if (!messages.length) return;
    const character = await this.store.get('characters', input.characterId);
    if (!character) return;
    const record: NotificationRecord = {
      id: `agent:${groupId}`,
      characterId: character.id,
      messageId: messages[0].id,
      messageIds: messages.map((m) => m.id),
      deliveryKind: input.task?.type === 'requested' || input.user ? 'requested' : 'initiative',
      title: character.persona.name,
      body: messages.map((m) => m.content).join('\n\n'),
      createdAt: messages[0].createdAt,
      status: 'pending',
    };
    await this.store.put('notifications', record);
  }
  async flushOutbox(cid: string): Promise<void> {
    const character = await this.store.get('characters', cid);
    if (!character) return;
    for (const record of await this.store.list('notifications', cid, 100)) {
      if (!record.id.startsWith('agent:') || record.status !== 'pending') continue;
      if (!(await this.host.notifications.enabled())) continue;
      await this.host.notifications.show(record, character);
      await this.store.put('notifications', {
        ...record,
        status: 'delivered',
        deliveredAt: Date.now(),
      });
    }
  }
}
