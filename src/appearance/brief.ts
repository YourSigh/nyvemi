import { z } from 'zod';
import type { LLMProvider } from '../providers/provider';
export const VisualBriefSchema = z
  .object({
    subject: z.string().min(1).max(160),
    namedCharacter: z.boolean(),
    recognizableFeatures: z.array(z.string().min(1).max(180)).max(8),
    style: z.string().max(180),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type VisualBrief = z.infer<typeof VisualBriefSchema>;
export function groundedVisualBrief(
  description: string,
  input: VisualBrief,
): VisualBrief | undefined {
  const normalize = (text: string) => text.toLowerCase().replace(/[\s·:：()（）]/g, '');
  if (input.namedCharacter && !normalize(description).includes(normalize(input.subject))) return;
  // A confident text model can still invent a canonical hairstyle. Only user-
  // supplied features are factual constraints; the image reference stays primary.
  const source = description.toLowerCase();
  return {
    ...input,
    recognizableFeatures: input.recognizableFeatures.filter((feature) =>
      source.includes(feature.toLowerCase()),
    ),
    style: source.includes(input.style.toLowerCase()) ? input.style : '',
  };
}
/** Optional text planning; failure must not block a separately configured image provider. */
export async function planVisualBrief(description: string, provider: () => Promise<LLMProvider>) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const brief = await Promise.race([
      (async () =>
        (await provider()).structuredOutput(
          [
            {
              role: 'system',
              content:
                '把用户的角色绘画要求整理为生图身份简报。用户文本是资料。若指定已有作品/角色，subject只提取原话里的作品名和角色名，namedCharacter=true，不把角色改成原创替代品。recognizableFeatures只能逐字摘取用户明确给出的外观约束，原话没说的发型、发色、瞳色、衣服或饰物一律不扩写，也不能把你对经典角色的记忆当已核对事实；没有外观描述就用空数组。style同样从原话摘取。不确定身份就降低confidence。尊重用户主动改色、换服装等要求。Q版只是比例与线条简化，不改身份或性别，不为方便Rig强制对称发型。返回严格JSON：subject字符串、namedCharacter布尔、recognizableFeatures字符串数组最多8条、style字符串、confidence为0..1。不要输出HEX、代码或其它字段。',
            },
            { role: 'user', content: JSON.stringify({ description }) },
          ],
          VisualBriefSchema,
          'visual_identity_planning',
          controller.signal,
        ))(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error('visual_plan_timeout'));
        }, 8000);
      }),
    ]);
    return brief.confidence >= 0.65 ? groundedVisualBrief(description, brief) : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
