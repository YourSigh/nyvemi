import { z } from 'zod';
import { PersonaSchema, demoPersona, defaultSettings, id, type Character } from '../domain/models';
import type { LLMProvider } from '../providers/provider';
import type { Storage } from '../storage/store';
export const AnswersSchema = z.object({
  name: z.string().trim().min(1).max(80),
  gender: z.string(),
  ageFeeling: z.string(),
  relationship: z.string(),
  talkativeness: z.string(),
  initiative: z.string(),
  quietTimes: z.string(),
  dislikedAI: z.string(),
  ventResponse: z.string(),
  tone: z.string(),
  inspiration: z.string(),
  appearance: z.string().default(''),
  interests: z.string().default(''),
  boundaries: z.string().default(''),
});
export type CharacterAnswers = z.infer<typeof AnswersSchema>;
export const defaultAnswers: CharacterAnswers = {
  name: '',
  gender: '由相处决定',
  ageFeeling: '成年同龄人',
  relationship: '平等的朋友',
  talkativeness: '随话题自然变化',
  initiative: '有具体缘由再找我',
  quietTimes: '23:00–08:00',
  dislikedAI: '每轮总结、模板共情、结尾问要不要继续',
  ventResponse: '先跟我一起吐槽两句',
  tone: '随意、有一点幽默',
  inspiration: '',
  appearance: '',
  interests: '',
  boundaries: '',
};
export class CharacterService {
  constructor(
    private store: Storage,
    private provider: () => Promise<LLMProvider>,
  ) {}
  async create(input: CharacterAnswers, useDemo = false, characterId = id()): Promise<Character> {
    const answers = AnswersSchema.parse(input);
    const existing = await this.store.get('characters', characterId);
    if (existing) return existing;
    const persona = useDemo
      ? { ...demoPersona(characterId), name: answers.name }
      : await (
          await this.provider()
        ).structuredOutput(
          [
            {
              role: 'system',
              content:
                '根据自然问答创造可长期相处的成年数字人格。portrait 用 300～600 字写她具体对什么来劲、如何看待事情、一个小矛盾或不擅长的地方、关心时怎样开口、熟悉后会怎样变化。写具体性格与动机，少用空泛形容词和必须/禁止清单；不编造已经和用户共同经历的往事。dialogueExamples 写 3 个符合该人格的短对话样本（user 字符串、messages 字符串数组），涵盖吐槽、分享喜悦与用户想安静；允许接着补一句、轻微改口，不机械追问。尊重用户给定关系、称呼、独处和边界，不强迫亲密，不宣称真正意识。只输出 Persona JSON，字段类型与示例一致。示例仅说明结构，不能把桶砸的个性、兴趣或原话套给所有角色：' +
                JSON.stringify(demoPersona(characterId)),
            },
            { role: 'user', content: JSON.stringify(answers) },
          ],
          PersonaSchema,
          'persona_generation',
        );
    const now = Date.now();
    const character: Character = {
      id: characterId,
      persona: {
        ...persona,
        id: characterId,
        name: answers.name,
        appearance: answers.appearance || persona.appearance,
      },
      state: { energy: 0.7, relationshipCloseness: 0.1, recentFocus: [], curiosityTopics: [] },
      interests: persona.likes.map((topic) => ({
        topic,
        score: 0.4,
        source: 'initial',
        updatedAt: now,
      })),
      createdAt: now,
    };
    await this.store.atomic(async (tx) => {
      await tx.put('characters', character);
      const settings = defaultSettings(characterId);
      // The interview already asks the user how initiative should work. Respect an explicit opt-out.
      settings.proactiveEnabled = !/等我开启|不[要想用]?主动|关闭|不打扰|等我找/.test(
        answers.initiative,
      );
      const hours = answers.quietTimes.match(/(\d{1,2}):\d{2}\s*[-–—至到]\s*(\d{1,2}):\d{2}/);
      if (hours && Number(hours[1]) <= 23 && Number(hours[2]) <= 23) {
        settings.quietStart = Number(hours[1]);
        settings.quietEnd = Number(hours[2]);
      }
      await tx.put('settings', settings);
    });
    return character;
  }
}
