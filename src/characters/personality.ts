import { z } from 'zod';
import { PersonalitySteeringSchema, type Character, type Persona } from '../domain/models';
import type { Storage } from '../storage/store';

export const maxCharacterNameLength = 80;
const NameSchema = z.string().trim().min(1).max(maxCharacterNameLength);
const DraftSchema = PersonalitySteeringSchema.required().extend({ name: NameSchema });
export type PersonalityDraft = z.infer<typeof DraftSchema>;

export const personalityFields = [
  {
    key: 'personality',
    label: '性格',
    placeholder: '比如慢热，有自己的主见',
  },
  {
    key: 'speech',
    label: '说话方式',
    placeholder: '比如更口语，偶尔接个梗',
  },
  {
    key: 'relationship',
    label: '相处方式',
    placeholder: '比如像老朋友，能互相吐槽',
  },
  {
    key: 'boundaries',
    label: '聊天边界',
    placeholder: '比如别替我做决定',
  },
] as const;

export function personalityDraft(persona: Persona): PersonalityDraft {
  return {
    name: persona.name,
    personality: persona.userSteering?.personality ?? '',
    speech: persona.userSteering?.speech ?? '',
    relationship: persona.userSteering?.relationship ?? '',
    boundaries: persona.userSteering?.boundaries ?? '',
  };
}

export function personalityEditable(character: Character): boolean {
  return !character.creationActive;
}

export async function updatePersonality(
  store: Storage,
  characterId: string,
  input: PersonalityDraft,
): Promise<Character> {
  const parsed = DraftSchema.safeParse(input);
  if (!parsed.success) throw new Error('请填写名字，并检查各项字数。');
  const { name, ...fields } = parsed.data;
  const steering = PersonalitySteeringSchema.parse(
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value)),
  );
  return store.atomic(async (tx) => {
    const character = await tx.get('characters', characterId);
    if (!character) throw new Error('找不到这个角色。');
    if (!personalityEditable(character)) throw new Error('聊完开场问题后就可以编辑性格。');
    const next: Character = {
      ...character,
      persona: {
        ...character.persona,
        name,
        userSteering: Object.keys(steering).length ? steering : undefined,
      },
    };
    await tx.put('characters', next);
    const hatching = await tx.get('hatchings', characterId);
    if (hatching?.status === 'complete' && hatching.answers.name !== name)
      await tx.put('hatchings', {
        ...hatching,
        answers: { ...hatching.answers, name },
        nameVersion: 1,
      });
    return next;
  });
}
