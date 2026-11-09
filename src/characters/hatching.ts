import { chooseVoice, openingVoiceChoices, VoiceRequestSchema } from '../speech/selection';
import { voiceOptions, voiceProfile } from '../speech/preferences';
import { visualThemes } from '../theme/visual-presets';
import { understandName } from './name';
import { deliverHatching, waitForTyping } from './hatching-delivery';
import { messageChunks } from '../chat/delivery';
import { z } from 'zod';
import { id, defaultSettings, type Message } from '../domain/models';
import { personaShape } from './persona-shape';
import {
  AnswersSchema,
  defaultAnswers,
  type CharacterAnswers,
  type CharacterService,
} from './service';
import type { Storage } from '../storage/store';
import type { LLMProvider } from '../providers/provider';
export const hatchQuestions: {
  key: 'color' | keyof CharacterAnswers | 'voice';
  question: string;
  choices: string[];
}[] = [
  {
    key: 'color',
    question: '先铺上柔软的粉白色。你喜欢这个感觉，还是想试试别的颜色？',
    choices: visualThemes.filter((theme) => theme.id !== 'sakura').map((theme) => theme.option),
  },
  {
    key: 'name',
    question: '那……你想怎么叫我？',
    choices: ['你帮我取一个', '让我想想，就叫小悠吧'],
  },
  {
    key: 'tone',
    question: '平时相处，你希望我是什么脾气？',
    choices: [
      '温柔，但有自己的想法',
      '活泼一点，能一起闹',
      '嘴上毒一点，别太客气',
      '淡定随意，有点幽默',
    ],
  },
  {
    key: 'relationship',
    question: '我们从什么关系开始比较自在？',
    choices: ['平等的朋友', '互相吐槽的搭子', '慢慢熟悉，别急着定义'],
  },
  {
    key: 'interests',
    question: '除了和你聊天，也给我留点自己的爱好吧。你觉得我会对什么来劲？',
    choices: ['音乐、散步和小发现', '游戏、科技和冷知识', '画画、电影和好吃的', '以后慢慢发现吧'],
  },
  {
    key: 'boundaries',
    question: '还有什么是你不喜欢的？比如聊天时，哪些话一听就想跑。',
    choices: [
      '别每句话都问要不要继续',
      '不说教，不催我回消息',
      '别总是附和我',
      '尊重我想安静的时候',
    ],
  },
  {
    key: 'appearance',
    question:
      '现在想象一下，我从这颗蛋里出来，会是什么样子？发型、衣服、气质都可以说，也可以之后给我参考图。',
    choices: [
      '清爽短发，宽松白色外套',
      '银白长发，柔和的粉白配色',
      '毛绒玩偶的感觉，穿红色小外套',
      '先做一颗蛋也挺好',
    ],
  },
  {
    key: 'voice',
    question: '最后，你想听到怎样的声音？',
    choices: [
      '温柔轻一点，慢慢说',
      '清亮活泼一点',
      '平静自然，别太甜',
      '低一点，语速放慢',
      '先静音聊天',
    ],
  },
];
export const HatchingSchema = z
  .object({
    id: z.string(),
    characterId: z.string(),
    createdAt: z.number(),
    step: z.number().int().min(0).max(hatchQuestions.length),
    answers: AnswersSchema.extend({ name: z.string().max(80) }),
    color: z.string().max(1000).optional(),
    voice: z.string().max(1000).optional(),
    status: z.enum(['asking', 'ready', 'complete']),
    pending: z
      .object({ text: z.string().max(1000), messageId: z.string() })
      .strict()
      .optional(),
    themeApplied: z.boolean().optional(),
    deferAppearance: z.boolean().optional(),
    nameVersion: z.literal(1).optional(),
    nameInput: z.string().max(1000).optional(),
    outbox: z
      .object({
        messageIds: z.array(z.string()).min(1).max(8),
        delivered: z.number().int().min(0).max(8),
        startedAt: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((d) => !d.outbox || d.outbox.delivered < d.outbox.messageIds.length, {
    message: 'Invalid delivery cursor',
  })
  .refine(
    (d) =>
      d.status === 'asking' ? d.step < hatchQuestions.length : d.step === hatchQuestions.length,
    { message: 'Invalid hatching progress' },
  );
export type HatchingDraft = z.infer<typeof HatchingSchema>;
const Reply = z.object({
  acknowledgement: z.string().trim().min(1).max(160),
  answer: z.string().trim().max(1000).optional(),
  deferAppearance: z.boolean().optional(),
  voiceStyle: VoiceRequestSchema.shape.tone,
  voice: VoiceRequestSchema.optional(),
});
export class HatchingService {
  constructor(
    private store: Storage,
    private provider: () => Promise<LLMProvider>,
    private characters: CharacterService,
    private wait = waitForTyping,
  ) {}
  async start() {
    const existing = (await this.store.list('characters'))[0];
    if (existing) return existing;
    const lock = 'hatching-start';
    if (!(await this.store.lease(lock, Date.now(), 30000))) throw Error('正在准备见面，请稍候');
    try {
      const again = (await this.store.list('characters'))[0];
      if (again) return again;
      const cid = id(),
        now = Date.now();
      const character = {
        id: cid,
        persona: {
          ...personaShape(cid, 'Nyvemi'),
          identity: '一个正在和你慢慢熟悉的朋友',
          corePersonality: ['温柔但有自己的想法'],
          speechStyle: ['简短自然，不急着说教'],
        },
        state: { energy: 0.7, relationshipCloseness: 0.1, recentFocus: [], curiosityTopics: [] },
        interests: [],
        createdAt: now,
        egg: true,
        creationActive: true,
        appearancePending: true,
      };
      await this.store.atomic(async (tx) => {
        await tx.put('characters', character);
        await tx.put('settings', { ...defaultSettings(cid), voice: voiceProfile() });
        await tx.put('hatchings', {
          id: cid,
          characterId: cid,
          createdAt: now,
          step: 0,
          answers: { ...defaultAnswers },
          status: 'asking',
          outbox: {
            messageIds: [`hatch:${cid}:0:hello`, `hatch:${cid}:0:question`],
            delivered: 0,
            startedAt: now,
          },
        });
        await tx.put('messages', {
          ...this.message(cid, 0, 'hello', '嗨，我在这儿。', now),
          status: 'pending',
        });
        await tx.put('messages', {
          ...this.message(cid, 0, 'question', hatchQuestions[0].question, now + 1),
          status: 'pending',
        });
      });
      return character;
    } finally {
      await this.store.release(lock);
    }
  }
  private message(
    cid: string,
    step: number,
    part: string,
    content: string,
    createdAt = Date.now(),
  ): Message {
    return {
      id: `hatch:${cid}:${step}:${part}`,
      characterId: cid,
      role: part === 'user' ? 'user' : 'assistant',
      content,
      createdAt,
      origin: 'chat',
      status: 'complete',
    };
  }
  async load(cid: string) {
    const draft = await this.store.get('hatchings', cid);
    // Only old, still-unnamed onboarding drafts used this placeholder. Explicit user names win.
    if (draft && draft.step < 2 && !draft.answers.name && !draft.nameVersion) {
      await this.store.atomic(async (tx) => {
        const fresh = await tx.get('hatchings', cid),
          character = await tx.get('characters', cid);
        if (
          fresh &&
          fresh.step < 2 &&
          !fresh.answers.name &&
          !fresh.nameVersion &&
          character?.creationActive &&
          character.persona.name === '小小'
        )
          await tx.put('characters', {
            ...character,
            persona: { ...character.persona, name: 'Nyvemi' },
          });
      });
    }
    return draft;
  }
  async resume(cid: string, updated: () => void = () => {}, signal?: AbortSignal) {
    const lock = `hatching:${cid}`;
    if (!(await this.store.lease(lock, Date.now(), 120000))) return this.load(cid);
    try {
      const d = await this.load(cid);
      return d ? await deliverHatching(this.store, d, updated, this.wait, signal) : d;
    } finally {
      await this.store.release(lock);
    }
  }
  async repairLegacyName(cid: string, signal?: AbortSignal) {
    const lock = `hatching:${cid}`;
    if (!(await this.store.lease(lock, Date.now(), 45000))) return;
    try {
      const d = await this.load(cid),
        c = await this.store.get('characters', cid);
      if (
        !d ||
        !c ||
        d.step < 2 ||
        d.nameVersion === 1 ||
        d.outbox ||
        c.persona.name !== d.answers.name
      )
        return;
      const original = await this.store.get('messages', `hatch:${cid}:1:user`);
      const result = await understandName(
        this.provider,
        d.nameInput ?? original?.content ?? d.answers.name,
        signal,
      );
      if (!result.name) return;
      await this.store.atomic(async (tx) => {
        const current = await tx.get('characters', cid),
          fresh = await tx.get('hatchings', cid);
        if (
          !current ||
          !fresh ||
          fresh.nameVersion === 1 ||
          current.persona.name !== d.answers.name
        )
          return;
        await tx.put('characters', {
          ...current,
          persona: { ...current.persona, name: result.name! },
        });
        await tx.put('hatchings', {
          ...fresh,
          answers: { ...fresh.answers, name: result.name! },
          nameVersion: 1,
          nameInput: d.nameInput ?? original?.content ?? d.answers.name,
        });
      });
    } catch {
      /* A failed optional migration never changes or deletes the existing name. */
    } finally {
      await this.store.release(lock);
    }
  }
  async answer(
    cid: string,
    text: string,
    applyColor?: (description: string) => Promise<void>,
    updated?: () => void,
    signal?: AbortSignal,
  ) {
    const lock = `hatching:${cid}`;
    if (!(await this.store.lease(lock, Date.now(), 120000))) throw Error('等我接上这一句');
    try {
      let draft = await this.load(cid);
      if (draft?.outbox)
        draft = await deliverHatching(this.store, draft, updated ?? (() => {}), this.wait, signal);
      if (!draft || draft.status !== 'asking') return draft;
      const startedAt = Date.now();
      const q = hatchQuestions[draft.step];
      const value = text.trim();
      if (!value || value.length > 1000) throw Error('这一句请控制在1000字以内');
      const revised = Boolean(draft.pending && draft.pending.text !== value);
      if (revised && q.key === 'color') draft.themeApplied = false;
      const user = {
        ...this.message(cid, draft.step, 'user', value),
        id: draft.pending?.messageId ?? id(),
      };
      if (!draft.pending || revised) {
        draft.pending = { text: value, messageId: user.id };
        await this.store.atomic(async (tx) => {
          await tx.put('hatchings', draft);
          await tx.put('messages', user);
        });
        updated?.();
      }
      try {
        const recentReplies = (await this.store.list('messages', cid, 8))
          .filter((m) => m.role === 'assistant')
          .slice(0, 4)
          .map((m) => m.content);
        if (q.key === 'color' && !draft.themeApplied) {
          await applyColor?.(value);
          draft.themeApplied = Boolean(applyColor);
          await this.store.put('hatchings', draft);
        }
        let reply: z.infer<typeof Reply>;
        let normalizedName: string | undefined;
        try {
          if (q.key === 'name') {
            const named = await understandName(this.provider, value, signal);
            if (named.name === null) {
              const clarification = {
                ...this.message(cid, draft.step, `clarify:${user.id}`, named.clarification!),
                status: 'pending' as const,
              };
              const revisedDraft: HatchingDraft = {
                ...draft,
                pending: undefined,
                outbox: { messageIds: [clarification.id], delivered: 0, startedAt },
              };
              await this.store.atomic(async (tx) => {
                await tx.put('hatchings', revisedDraft);
                await tx.put('messages', clarification);
              });
              updated?.();
              return await deliverHatching(
                this.store,
                revisedDraft,
                updated ?? (() => {}),
                this.wait,
                signal,
              );
            }
            normalizedName = named.name;
            reply = { acknowledgement: named.acknowledgement };
          } else {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 18000);
            try {
              reply = await (
                await this.provider()
              ).structuredOutput(
                [
                  {
                    role: 'system',
                    content:
                      '你正在和刚认识的人聊天，你的形象暂时是一颗蛋。根据用户刚刚的回答，用一句自然、具体、简短的话接住，不用向导口吻，不写“已记录”“这会加入设定”，也别反复说“我记住了/记下了”。不要机械复述完整答案，多数用3到20字自然接一句，别重复recentReplies里的表达。不夸张吹捧、不说AI或数字人。只回应当前答案，不另问问题，下一题由应用发送。输出JSON acknowledgement；answer用于提取简洁设定，名字题提取名字，用户请你取名时给一个自然名字；其余不要篡改用户偏好。外貌题用户想晚点再决定时输出deferAppearance=true。只有声音题可以输出voice对象，tone取gentle/bright/calm/low，gender取feminine/masculine，pace取slow/natural/fast。只填用户表达或明显暗示的偏好，静音意图不输出voice。',
                  },
                  {
                    role: 'user',
                    content: JSON.stringify({
                      question: q.question,
                      key: q.key,
                      answer: value,
                      known: draft.answers,
                      recentReplies,
                      next: hatchQuestions[draft.step + 1]?.question ?? null,
                    }),
                  },
                ],
                Reply,
                'hatching_conversation',
                controller.signal,
              );
            } finally {
              clearTimeout(timer);
            }
          }
        } catch {
          if (q.key === 'name') throw Error('没能确认你想起的名字，点重试我再听一次；还没有改名。');
          reply = {
            acknowledgement:
              q.key === 'color' ? '嗯，这个颜色看着很舒服。' : '好，我懂你说的那个感觉了。',
          };
        }
        const name = normalizedName ?? draft.answers.name;
        const nextStep = draft.step + 1,
          next = hatchQuestions[nextStep];
        const answers = {
          ...draft.answers,
          ...(q.key in defaultAnswers ? { [q.key]: q.key === 'name' ? name : value } : {}),
        };
        const replies = messageChunks([reply.acknowledgement]).map((content, n) => ({
          ...this.message(cid, nextStep, `ack:${n}`, content),
          status: 'pending' as const,
        }));
        if (next)
          replies.push({
            ...this.message(cid, nextStep, 'question', next.question),
            status: 'pending',
          });
        const nextDraft: HatchingDraft = {
          ...draft,
          step: nextStep,
          pending: undefined,
          answers,
          ...(q.key === 'name' ? { nameVersion: 1 as const, nameInput: value } : {}),
          outbox: { messageIds: replies.map((m) => m.id), delivered: 0, startedAt },
          status: next ? 'asking' : 'ready',
          ...(q.key === 'color' ? { color: value } : {}),
          ...(q.key === 'voice' ? { voice: value } : {}),
          ...(q.key === 'appearance'
            ? { deferAppearance: reply.deferAppearance ?? value === q.choices[3] }
            : {}),
        };
        await this.store.atomic(async (tx) => {
          await tx.put('hatchings', nextDraft);
          await tx.put('messages', {
            ...user,
            ...(await tx.get('messages', user.id)),
            status: 'complete',
          });
          const character = await tx.get('characters', cid);
          if (character && q.key === 'name')
            await tx.put('characters', { ...character, persona: { ...character.persona, name } });
          if (q.key === 'voice') {
            const settings = await tx.get('settings', cid);
            if (settings) {
              const silent = value === q.choices[4];
              const preference =
                openingVoiceChoices[q.choices.indexOf(value)] ??
                reply.voice ??
                (reply.voiceStyle ? { tone: reply.voiceStyle } : undefined);
              await tx.put('settings', {
                ...settings,
                voice: {
                  ...voiceOptions(settings.voice),
                  ...(silent ? { enabled: false, playbackSet: true as const } : {}),
                  description: value,
                },
                voiceOffer: !silent && preference ? chooseVoice(preference) : undefined,
              });
            }
          }
          for (const message of replies) await tx.put('messages', message);
        });
        updated?.();
        return await deliverHatching(
          this.store,
          nextDraft,
          updated ?? (() => {}),
          this.wait,
          signal,
        );
      } catch (e) {
        const old = await this.store.get('messages', user.id);
        const current = await this.load(cid);
        if (old && current?.pending?.messageId === user.id)
          await this.store.put('messages', { ...old, status: 'error' });
        throw e;
      }
    } finally {
      await this.store.release(lock);
    }
  }
  async finish(cid: string, updated: () => void = () => {}, signal?: AbortSignal) {
    const lock = `hatching:${cid}`;
    if (!(await this.store.lease(lock, Date.now(), 120000))) throw Error('正在整理最后一点');
    try {
      let d = await this.load(cid);
      if (d?.outbox) d = await deliverHatching(this.store, d, updated, this.wait, signal);
      const c = await this.store.get('characters', cid);
      if (!c || !d) throw Error('找不到这次相遇');
      if (d.status === 'complete') return c;
      if (d.status !== 'ready') throw Error('还没聊到最后呢');
      const persona = await this.characters.personaFor(d.answers, cid);
      const completed = this.message(
        cid,
        d.step,
        'complete',
        d.deferAppearance
          ? '那就先做一颗蛋，陪你聊会儿。想好我的样子时再告诉我。'
          : '好，轮廓差不多有了。接下来，看看我会长成什么样吧。',
      );
      const finalDraft: HatchingDraft = {
        ...d,
        status: 'complete',
        outbox: { messageIds: [completed.id], delivered: 0, startedAt: Date.now() },
      };
      const character = await this.store.atomic(async (tx) => {
        const current = await tx.get('characters', cid);
        if (!current) throw Error('角色已被清空');
        const complete = {
          ...current,
          persona,
          creationActive: false,
          appearancePending: !d.deferAppearance,
          interests: persona.likes.map((topic) => ({
            topic,
            score: 0.4,
            source: 'initial' as const,
            updatedAt: Date.now(),
          })),
        };
        await tx.put('characters', complete);
        const settings = await tx.get('settings', cid);
        if (settings)
          await tx.put('settings', {
            ...settings,
            proactiveEnabled: !/不主动|不要主动|不打扰/.test(d.answers.boundaries),
          });
        await tx.put('hatchings', finalDraft);
        await tx.put('messages', { ...completed, status: 'pending' });
        return complete;
      });
      updated();
      await deliverHatching(this.store, finalDraft, updated, this.wait, signal);
      return character;
    } finally {
      await this.store.release(lock);
    }
  }
}
