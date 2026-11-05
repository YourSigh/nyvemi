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
    question: '你喜欢什么颜色呀？也可以说说你喜欢的感觉。',
    choices: ['淡粉色，柔和一点', '蓝灰色，安静一点', '清爽的薄荷绿', '暖一点的黑白灰'],
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
    question: '最后，你想听到怎样的声音？先用本机的声音试试，之后也能换。',
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
  })
  .strict()
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
  voiceEnabled: z.boolean().optional(),
  voiceStyle: z.enum(['gentle', 'bright', 'calm', 'low']).optional(),
});
export const voiceProfile = (style = 'gentle') => ({
  enabled: true,
  rate: style === 'bright' ? 1.05 : style === 'low' ? 0.85 : 0.92,
  pitch: style === 'low' ? 0.85 : style === 'calm' ? 1 : style === 'bright' ? 1.17 : 1.08,
});
export class HatchingService {
  constructor(
    private store: Storage,
    private provider: () => Promise<LLMProvider>,
    private characters: CharacterService,
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
          ...personaShape(cid, '小小'),
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
        });
        await tx.put('messages', this.message(cid, 0, 'hello', '嗨，我在这儿。', now));
        await tx.put(
          'messages',
          this.message(cid, 0, 'question', hatchQuestions[0].question, now + 1),
        );
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
    return this.store.get('hatchings', cid);
  }
  async answer(
    cid: string,
    text: string,
    applyColor?: (description: string) => Promise<void>,
    updated?: () => void,
  ) {
    const lock = `hatching:${cid}`;
    if (!(await this.store.lease(lock, Date.now(), 120000))) throw Error('等我接上这一句');
    try {
      const draft = await this.load(cid);
      if (!draft || draft.status !== 'asking') return draft;
      const q = hatchQuestions[draft.step];
      const value = text.trim();
      if (!value || value.length > 1000) throw Error('这一句请控制在1000字以内');
      const revised = Boolean(draft.pending && draft.pending.text !== value);
      if (revised && q.key === 'color') draft.themeApplied = false;
      const user = {
        ...this.message(cid, draft.step, 'user', value),
        ...(draft.pending ? { id: draft.pending.messageId } : {}),
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
        if (q.key === 'color' && !draft.themeApplied) {
          await applyColor?.(value);
          draft.themeApplied = Boolean(applyColor);
          await this.store.put('hatchings', draft);
        }
        let reply: z.infer<typeof Reply>;
        try {
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
                    '你正在和刚认识的人聊天，你的形象暂时是一颗蛋。根据用户刚刚的回答，用一句自然、具体、简短的话接住，不用向导口吻，不写“已记录”“这会加入设定”，不夸张吹捧、不说AI或数字人。只回应当前答案，不另问问题，下一题由应用发送。输出JSON acknowledgement；answer用于提取简洁设定，名字题提取名字，用户请你取名时给一个自然名字；其余不要篡改用户偏好。外貌题用户想晚点再决定时输出deferAppearance=true。声音题用户明确不要朗读时voiceEnabled=false，否则true。voiceStyle仅声音题按gentle/bright/calm/low选一项。',
                },
                {
                  role: 'user',
                  content: JSON.stringify({
                    question: q.question,
                    key: q.key,
                    answer: value,
                    known: draft.answers,
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
        } catch {
          reply = {
            acknowledgement:
              q.key === 'color'
                ? '嗯，这个颜色看着很舒服。'
                : q.key === 'name'
                  ? '好，那以后就这么叫我。'
                  : '好，我懂你说的那个感觉了。',
          };
        }
        const name =
          q.key === 'name'
            ? reply.answer?.slice(0, 80) || (value === '你帮我取一个' ? '小悠' : value.slice(0, 80))
            : draft.answers.name;
        const nextStep = draft.step + 1,
          next = hatchQuestions[nextStep];
        const answers = {
          ...draft.answers,
          ...(q.key in defaultAnswers ? { [q.key]: q.key === 'name' ? name : value } : {}),
        };
        const nextDraft: HatchingDraft = {
          ...draft,
          step: nextStep,
          pending: undefined,
          answers,
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
            if (settings)
              await tx.put('settings', {
                ...settings,
                voice: {
                  ...voiceProfile(reply.voiceStyle),
                  enabled: reply.voiceEnabled ?? value !== '先静音聊天',
                  description: value,
                },
              });
          }
          await tx.put('messages', this.message(cid, nextStep, 'ack', reply.acknowledgement));
          if (next)
            await tx.put(
              'messages',
              this.message(cid, nextStep, 'question', next.question, Date.now() + 1),
            );
        });
        updated?.();
        return nextDraft;
      } catch (e) {
        const old = await this.store.get('messages', user.id);
        if (old) await this.store.put('messages', { ...old, status: 'error' });
        throw e;
      }
    } finally {
      await this.store.release(lock);
    }
  }
  async finish(cid: string) {
    const lock = `hatching:${cid}`;
    if (!(await this.store.lease(lock, Date.now(), 120000))) throw Error('正在整理最后一点');
    try {
      const d = await this.load(cid);
      const c = await this.store.get('characters', cid);
      if (!c || !d) throw Error('找不到这次相遇');
      if (d.status === 'complete') return c;
      if (d.status !== 'ready') throw Error('还没聊到最后呢');
      const persona = await this.characters.personaFor(d.answers, cid);
      return await this.store.atomic(async (tx) => {
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
        await tx.put('hatchings', { ...d, status: 'complete' });
        await tx.put(
          'messages',
          this.message(
            cid,
            d.step,
            'complete',
            d.deferAppearance
              ? '那就先做一颗蛋，陪你聊会儿。想好我的样子时再告诉我。'
              : '好，轮廓差不多有了。接下来，看看我会长成什么样吧。',
          ),
        );
        return complete;
      });
    } finally {
      await this.store.release(lock);
    }
  }
}
