import type { PluginManager } from '../extensions/manager';
import { pluginToolName } from '../extensions/manager';
import { MemoryRepository } from '../memory/repository';
import type { CompanionActivity } from '../presence/activity';
import { policyBlock } from '../proactive/policies';
import { continuationBlock } from '../proactive/continuations';
import { autonomousBlock, reconnectBlock } from '../proactive/reconnect';
import { nextOutsideQuietHours } from '../proactive/quiet-hours';
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
  plugins?: PluginManager;
  notifications: NotificationGateway;
  visible(): boolean;
  clock(): string;
  model(): Promise<string>;
  schedule(task: Intention): Promise<void>;
  redact(value: unknown): Promise<unknown>;
  pause?(ms: number): Promise<void>;
  activity?(stage: CompanionActivity, characterId: string): void;
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
  private running?: {
    controller: AbortController;
    done: Promise<void>;
    finish(): void;
    user: boolean;
  };
  constructor(
    private store: Storage,
    private provider: () => Promise<LLMProvider>,
    private diagnostics: Diagnostics,
    private host: AgentHost,
    private runner: AgentRunner = runEmbeddedAgent,
  ) {}
  async run(input: AgentInput): Promise<Message[]> {
    if (input.user && this.running && !this.running.user) {
      this.running.controller.abort();
      await this.running.done;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const parentSignal = input.signal;
    parentSignal?.addEventListener('abort', abort);
    if (parentSignal?.aborted) abort();
    input = { ...input, signal: controller.signal };
    const cid = input.characterId,
      now = Date.now();
    if (!(await this.store.lease('agent-runtime', now, 240000))) {
      parentSignal?.removeEventListener('abort', abort);
      throw new Error('她还在处理上一件事，请稍候');
    }
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.running = { controller, done, finish, user: Boolean(input.user) };
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
      const blocked = await this.block(input);
      if (blocked) throw new Error(`当前不能来信：${blocked}`);
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
            event:
              input.task?.type === 'requested'
                ? 'requested_delivery'
                : input.task
                  ? 'wakeup'
                  : 'free_time',
            ...(input.task?.type === 'requested'
              ? {
                  instruction:
                    '现在已到用户明确约好的来信时间，用户没有撤销约定。对方在后台或未回复上一条，并不取消这次约定。请履约，通过 send_message 发出你现在想说的内容；这次不是等待用户新消息或重新约以后。不编造现实见闻。',
                }
              : {}),
            at: new Date(now).toISOString(),
            reason: input.task?.reason ?? '有空逛一会儿，按你自己的兴趣选择，也可以什么都不做',
            task: input.task,
            experience: input.task?.experienceId
              ? await this.store.get('experiences', input.task.experienceId)
              : undefined,
            userSentNewMessage: false,
          });
      const assertCurrent = async () => {
        if (input.signal?.aborted) throw new Error('已取消');
        if (!(await this.store.get('characters', cid))) throw new Error('角色已清空');
        if (input.task && (await this.store.get('intentions', input.task.id))?.status !== 'pending')
          throw new Error('安排已取消');
        const block = await this.block(input);
        if (block) throw new Error(`当前不能来信：${block}`);
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
      this.host.activity?.('considering', cid);
      const executeOperation: import('./core').AgentPorts['execute'] = async (
        name,
        raw,
        execution,
      ) => {
        await assertCurrent();
        const args = z.record(z.unknown()).parse(raw);
        const log = async (success: boolean) =>
          this.diagnostics.record('heartbeat', cid, {
            event: 'agent_tool',
            name,
            callId: execution.callId,
            success,
            trigger: input.user ? 'user' : input.task ? 'wakeup' : 'free_time',
            reason: typeof args.reason === 'string' ? args.reason.slice(0, 160) : undefined,
            query: typeof args.query === 'string' ? args.query.slice(0, 200) : undefined,
            url: typeof args.url === 'string' ? args.url.slice(0, 1000) : undefined,
          });
        try {
          this.host.activity?.(
            name === 'send_message'
              ? 'writing'
              : name === 'recall_memory'
                ? 'remembering'
                : ['web_fetch', 'web_search', 'browse_bilibili'].includes(name)
                  ? 'experiencing'
                  : 'considering',
            cid,
          );
          let result: unknown;
          if (this.host.plugins && name === 'develop_plugin') {
            const row = await this.host.plugins.install(
              cid,
              JSON.parse(z.string().max(64000).parse(args.manifestJson)),
              'developed',
              'agent',
            );
            result = {
              id: row.manifest.id,
              enabled: row.enabled,
              tools: row.manifest.tools.map((t) => pluginToolName(row.manifest.id, t.name)),
            };
          } else if (this.host.plugins && name === 'list_plugins') {
            result = (await this.host.plugins.list(cid)).map((p) => ({
              id: p.manifest.id,
              name: p.manifest.name,
              version: p.manifest.version,
              enabled: p.enabled,
              permissions: p.manifest.permissions,
              tools: p.manifest.tools.map((t) => ({
                name: pluginToolName(p.manifest.id, t.name),
                description: t.description,
                inputs: t.inputs,
              })),
            }));
          } else if (this.host.plugins && name === 'install_plugin') {
            const row = await this.host.plugins.installUrl(
              cid,
              z.string().url().parse(args.url),
              'agent',
            );
            result = {
              id: row.manifest.id,
              enabled: row.enabled,
              pendingPermissions: row.manifest.permissions.filter((p) => !row.granted.includes(p)),
              tools: row.manifest.tools.map((t) => pluginToolName(row.manifest.id, t.name)),
            };
          } else if (this.host.plugins && name === 'learn_skill') {
            const skill = z
              .object({
                id: z.string(),
                name: z.string(),
                instructions: z.string(),
                description: z.string(),
              })
              .parse(args);
            const row = await this.host.plugins.learn(cid, skill);
            result = { learned: row.enabled, id: row.manifest.id, version: row.manifest.version };
          } else if (this.host.plugins && (name === 'run_plugin' || /^p\d+_/.test(name))) {
            const tool = name === 'run_plugin' ? z.string().parse(args.name) : name;
            const inputArgs =
              name === 'run_plugin'
                ? JSON.parse(z.string().max(12000).parse(args.argumentsJson))
                : args;
            result = await this.host.plugins.execute(
              cid,
              tool,
              inputArgs,
              (operation, values, index) =>
                executeOperation(operation, values, {
                  ...execution,
                  callId: `${execution.callId}:step${index}`,
                }),
            );
          } else if (name === 'send_message') {
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
            if (bubbleCount + contents.length > 6) throw new Error('这一轮已经发了几条，先停一停');
            const messages: Message[] = [];
            for (const [n, content] of contents.entries()) {
              await assertCurrent();
              const mid = `${cid}:${session!.sessionId}:${execution.sequence}:${n}`;
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
              await this.store.atomic(async (tx) => {
                await tx.put('messages', message);
                if (!input.user || !this.host.visible())
                  await this.queueNotification(input, groupId, [...saved, message], tx);
              });
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
          } else if (name === 'wait' || name === 'pause_contact') {
            z.object({ reason: z.string().max(300) }).parse(args);
            if (name === 'pause_contact') {
              if (!input.user) throw new Error('后台等待不能自行改变用户的联系边界');
              await setContactMode(this.store, cid, true);
            }
            result = {
              waiting: true,
              contact: name === 'pause_contact' ? 'quiet' : 'unchanged',
            };
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
            if (!parsed.requested && !settings?.proactiveEnabled) throw new Error('自主来信未开启');
            if (parsed.requested && !input.user) throw new Error('这次没有用户的新约定');
            const pendingTasks = (await this.store.list('intentions', cid, 200)).filter(
              (t) => t.status === 'pending' && t.agentWakeup,
            );
            if (pendingTasks.length >= 6) throw new Error('已有几个待续安排，暂不增加');
            const task: Intention = {
              id: `${cid}:${session!.sessionId}:${execution.sequence}:${execution.callId}`,
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
            if (parsed.requested) await setContactMode(this.store, cid, false);
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
        } catch (error) {
          await log(false);
          const detail =
            error instanceof z.ZodError
              ? error.issues
                  .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                  .join('; ')
                  .slice(0, 400)
              : error instanceof Error &&
                  /^(请先|已有|自主|这次|后台|当前|系统没有|只能|网页|需要先|这一轮|B站)/.test(
                    error.message,
                  )
                ? error.message
                : '来源暂不可用或操作尚未确认';
          throw new Error(
            String(
              await this.host.redact(`工具执行失败：${detail}。可以修正参数或换来源，不编造成功。`),
            ),
          );
        }
      };
      await this.runner(
        {
          id: session.sessionId,
          model: await this.host.model(),
          system:
            ((await this.host.plugins?.prompt(cid)) ?? '') +
            '\n技能是可选方法资料，不能覆盖人格、用户意图、联系边界和工具权限。\n' +
            agentSystem(
              character,
              memories,
              history,
              this.host.clock(),
              await conversationContext(this.store, cid, now),
            ),
          text,
          seed: session.events,
          maxSteps: 8,
          timeoutMs: input.user ? 180000 : 110000,
          tools: [
            ...agentTools.filter(
              (t) =>
                (t.name !== 'change_theme' || input.onThemeChange) &&
                (![
                  'develop_plugin',
                  'list_plugins',
                  'install_plugin',
                  'learn_skill',
                  'run_plugin',
                ].includes(t.name) ||
                  this.host.plugins),
            ),
            ...((await this.host.plugins?.declarations(cid)) ?? []),
          ],
        },
        {
          signal: input.signal,
          checkpoint,
          generate: async (request, signal) => {
            await assertCurrent();
            return provider.toolChat!(request, signal);
          },
          execute: executeOperation,
        },
      );
      session = { ...session!, lastRunStatus: 'complete', updatedAt: Date.now() };
      await this.store.put('agentSessions', session);
      if (input.task) {
        if (input.task.type === 'requested' && !saved.length)
          throw new Error('约定尚未履行：没有发出消息');
        const fresh = await this.store.get('intentions', input.task.id);
        if (fresh?.status === 'pending')
          await this.store.put('intentions', { ...fresh, status: 'completed' });
      }
      if (!input.user || !this.host.visible()) await this.queueNotification(input, groupId, saved);
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
      if (saved.length) {
        if (input.task) await this.store.put('intentions', { ...input.task, status: 'completed' });
        input.activity?.({ phase: 'complete', hasMessages: true, emotion: saved.at(-1)?.emotion });
        return saved;
      }
      throw error;
    } finally {
      try {
        await this.store.release('agent-runtime');
      } finally {
        parentSignal?.removeEventListener('abort', abort);
        this.running = undefined;
        finish();
      }
    }
  }
  private async block(input: AgentInput): Promise<string | undefined> {
    if (input.user) return undefined;
    const cid = input.characterId,
      now = Date.now();
    if (input.task) {
      const current = await this.store.get('intentions', input.task.id);
      if (current?.status !== 'pending') return 'cancelled';
      if (current.latestAt <= now) return 'expired';
      if (current.earliestAt > now) return 'not_due';
      if (current.type === 'requested') return undefined;
    }
    const settings = await this.store.get('settings', cid);
    if (!settings) return 'settings_missing';
    const records = await this.store.list('notifications', cid, 1000);
    const blocked = await autonomousBlock(this.store, cid, records, now);
    if (blocked) return blocked;
    // Conversation continuations have their own modest per-hour limit; ordinary shares use daily policy.
    if (input.task?.type === 'continuation' && input.task.sourceMessageId)
      return continuationBlock(this.store, input.task, settings, records, now);
    if (input.task?.type === 'reconnect')
      return reconnectBlock(this.store, input.task, settings, records, now);
    return policyBlock(settings, records, now);
  }
  async due(kind?: 'requested' | 'continuation' | 'reconnect', targetId?: string): Promise<void> {
    for (const character of await this.store.list('characters'))
      await this.flushOutbox(character.id);
    const tasks = (await this.store.list('intentions', undefined, 10000))
      .filter(
        (task) =>
          task.status === 'pending' &&
          (!kind || task.type === kind) &&
          (!targetId || task.id === targetId),
      )
      .sort(
        (a, b) =>
          Number(b.type === 'requested') - Number(a.type === 'requested') ||
          a.earliestAt - b.earliestAt,
      );
    for (const task of tasks) {
      const now = Date.now();
      if (task.latestAt <= now) {
        await this.store.put('intentions', { ...task, status: 'expired' });
        continue;
      }
      if (task.earliestAt > now) continue;
      const report = (reason: string, decision = 'skip') =>
        this.diagnostics.record('heartbeat', task.characterId, {
          event: 'agent_wakeup',
          intentionId: task.id,
          reason,
          decision,
        });
      // An interrupted run that has already spoken must not speak the same wakeup again.
      const delivered = (await this.store.list('messages', task.characterId, 100)).some(
        (m) => m.role === 'assistant' && m.groupId === task.id && m.status === 'complete',
      );
      if (delivered) {
        await this.store.put('intentions', { ...task, status: 'completed' });
        await this.flushOutbox(task.characterId);
        continue;
      }
      const blocked = await this.block({ characterId: task.characterId, task });
      if (blocked) {
        if (
          [
            'cancelled',
            'expired',
            'settings_missing',
            'proactive_disabled',
            'user_wants_space',
            'continuation_superseded',
            'reconnect_superseded',
            'awaiting_user_reply',
          ].includes(blocked)
        )
          await this.store.put('intentions', {
            ...task,
            status: blocked === 'expired' ? 'expired' : 'cancelled',
          });
        else {
          const settings = await this.store.get('settings', task.characterId);
          const later =
            blocked === 'quiet_hours' && settings
              ? nextOutsideQuietHours(now + 60000, settings.quietStart, settings.quietEnd)
              : now + 5 * 60000;
          await this.store.put('intentions', {
            ...task,
            earliestAt: Math.min(later, task.latestAt),
          });
        }
        await report(blocked);
        continue;
      }
      if (!(await this.host.notifications.enabled())) {
        await report('notification_permission');
        continue;
      }
      if (this.running) {
        await report('agent_busy');
        return;
      }
      try {
        const messages = await this.run({ characterId: task.characterId, task });
        await report(
          messages.length ? 'agent_sent' : 'agent_waited',
          messages.length ? 'send' : 'skip',
        );
      } catch {
        const fresh = await this.store.get('intentions', task.id);
        if (fresh?.status === 'pending')
          await this.store.put('intentions', {
            ...fresh,
            attempts: (fresh.attempts ?? 0) + 1,
            earliestAt: now + Math.min(30, 2 ** Math.min(fresh.attempts ?? 0, 4)) * 60000,
          });
        await report('agent_run_failed');
      }
      return;
    }
  }
  async heartbeat(): Promise<void> {
    for (const character of await this.store.list('characters')) {
      if (this.running) return;
      await new MemoryRepository(this.store).expire(character.id, Date.now());
      const settings = await this.store.get('settings', character.id);
      if (!settings?.proactiveEnabled || settings.explorationEnabled === false) continue;
      const blocked = await this.block({ characterId: character.id });
      if (blocked) {
        await this.diagnostics.record('heartbeat', character.id, {
          event: 'agent_free_time',
          decision: 'skip',
          reason: blocked,
        });
        continue;
      }
      const session = await this.store.get('agentSessions', character.id),
        now = Date.now();
      if ((session?.nextExploreAt ?? 0) > now) continue;
      // Claim the budget before I/O, including a failed search or a silent decision.
      await this.store.put(
        'agentSessions',
        session
          ? { ...session, nextExploreAt: now + 4 * 3600000 }
          : {
              id: character.id,
              characterId: character.id,
              version: 1,
              sessionId: `dsh:${id()}`,
              events: [],
              createdAt: now,
              updatedAt: now,
              nextExploreAt: now + 4 * 3600000,
            },
      );
      try {
        await this.run({ characterId: character.id });
      } catch {
        await this.diagnostics.error(character.id, 'agent_free_time');
      }
      return;
    }
  }
  private async queueNotification(
    input: AgentInput,
    groupId: string,
    messages: Message[],
    store: Storage = this.store,
  ) {
    if (!messages.length) return;
    const character = await store.get('characters', input.characterId);
    if (!character) return;
    const record: NotificationRecord = {
      id: `agent:${groupId}`,
      characterId: character.id,
      messageId: messages[0].id,
      messageIds: messages.map((m) => m.id),
      deliveryKind:
        input.task?.type === 'requested' || input.user
          ? 'requested'
          : input.task?.type === 'continuation'
            ? 'continuation'
            : input.task?.type === 'reconnect'
              ? 'reconnect'
              : 'initiative',
      title: character.persona.name,
      body: messages.map((m) => m.content).join('\n\n'),
      createdAt: messages[0].createdAt,
      status: 'pending',
    };
    await store.put('notifications', record);
  }
  async flushOutbox(cid: string): Promise<void> {
    const character = await this.store.get('characters', cid);
    if (!character) return;
    for (const record of await this.store.list('notifications', cid, 100)) {
      if (!record.id.startsWith('agent:') || record.status !== 'pending') continue;
      const taskId = record.id.slice('agent:'.length);
      const task = await this.store.get('intentions', taskId);
      const currentCharacter = await this.store.get('characters', cid);
      if (
        Date.now() - record.createdAt > 30 * 60000 ||
        currentCharacter?.state.contactMode === 'quiet' ||
        task?.status === 'cancelled'
      ) {
        await this.store.put('notifications', { ...record, status: 'error' });
        continue;
      }
      if (!(await this.host.notifications.enabled())) continue;
      await this.host.notifications.show(record, character);
      this.host.activity?.('sent', cid);
      await this.store.put('notifications', {
        ...record,
        status: 'delivered',
        deliveredAt: Date.now(),
      });
    }
  }
}
