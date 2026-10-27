import { expressionFields } from '../character/interaction';
import { z } from 'zod';
export const ContinuationSchema = z.object({
  topic: z.string().trim().min(3).max(300),
  reason: z.string().trim().min(3).max(500),
  afterMinutes: z.number().min(2).max(15),
});
export type Continuation = z.infer<typeof ContinuationSchema>;
const OutcomeSchema = z
  .object({
    ...expressionFields,
    messages: z.array(z.string().trim().min(1).max(6000)).max(6),
    continuation: ContinuationSchema.nullable().optional(),
    theme: z
      .object({ description: z.string().trim().min(1).max(500) })
      .nullable()
      .optional(),
    schedule: z
      .object({ afterSeconds: z.number().min(10).max(86400) })
      .nullable()
      .optional(),
  })
  .refine((value) => !(value.theme && value.schedule), { message: '一次只执行一种界面或排程动作' });
export type ChatOutcome = z.infer<typeof OutcomeSchema>;
export function parseChatOutcome(raw: string): ChatOutcome {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return OutcomeSchema.parse(JSON.parse(text));
  } catch {
    if (text && !/^[{[]/.test(text) && text.length <= 6000) return { messages: [text] };
    throw new Error('回复格式不完整，请重试本轮');
  }
}
export function conversationActions(
  enabled: boolean,
  canSchedule: boolean,
  canChangeTheme = false,
): string {
  return `JSON 还可含 continuation、schedule 与 theme，平时用 null。\ncontinuation：${enabled ? '允许' : '用户关闭了自主来信，必须为 null'}。如果这轮有一个具体的余念，几分钟后你还可能想接着聊，可以留 {"topic":"与刚才对话相关的具体念头","reason":"为什么之后仍值得聊","afterMinutes":3}；2～15 分钟。它可以是一个还没想完的看法、舍不得结束的话题或对刚才那句话的新反应，不必等用户将来开会等外部事件。只记缘由，不预写消息，不每轮都留；普通寒暄、已经说尽、用户要安静或话题结束时为 null。这里是公开可解释的简短行为意图，不输出推理过程。到时会根据新对话重新决定说或不说。\nschedule：${canSchedule ? '可用' : '不可用，必须为 null'}。只有最新用户消息明确要求过一段时间发消息，才填 {"afterSeconds":60}（10 秒～24 小时）；理解整句话的意图，不受开场词或词序限制。不能从引用、假设、用户自己的行程或你自己的想法推断用户已要求排程。schedule 非空时 messages 用空数组、continuation 用 null，应用登记成功后才发送确认，不能抢先许诺。\ntheme：${canChangeTheme ? '这轮允许响应界面换色请求或用户自己的颜色偏好' : '这轮不允许换色，必须为 null'}。用户说把 App/这里换成某种颜色、调亮调暗，或表达自己喜欢/更偏爱某种颜色时，填 {"description":"用户想要的完整颜色和氛围"}，只理解最新这条偏好或请求；用户自己的明确颜色偏好可以换色，第三人的偏好、问你喜欢什么、衣服、头像、引用或假设不操作。用户说暗一点等相对调整时，结合当前配色补全描述。messages 自然简短接话，不讲技术、不再问颜色，continuation 和 schedule 用 null。`;
}
