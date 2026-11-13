import { z } from 'zod';
import type { Memory, Message } from '../domain/models';
import type { Storage } from '../storage/store';

const preferenceKey = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/);
const preferenceChange = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('set'),
      key: preferenceKey,
      quote: z.string().trim().min(2).max(240),
      preference: z.string().trim().min(2).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal('forget'),
      key: preferenceKey,
      quote: z.string().trim().min(2).max(240),
    })
    .strict(),
]);
const eventSchema = z.object({
  key: preferenceKey,
  action: z.enum(['set', 'forget']),
  messageAt: z.number(),
});

export function isDialoguePreference(memory: Memory): boolean {
  return memory.type === 'relationship' && memory.metadata?.kind === 'dialogue_preference';
}

export async function recordedDialoguePreference(
  store: Storage,
  characterId: string,
  source: string,
) {
  return (await store.list('memories', characterId, 10000)).some(
    (memory) => isDialoguePreference(memory) && memory.source === source,
  );
}

export async function dialoguePreferences(store: Storage, characterId: string) {
  const events = (await store.list('memories', characterId, 10000))
    .filter(isDialoguePreference)
    .flatMap((memory) => {
      const parsed = eventSchema.safeParse(memory.metadata);
      return parsed.success ? [{ ...parsed.data, memory }] : [];
    })
    .sort((a, b) => b.messageAt - a.messageAt || b.memory.updatedAt - a.memory.updatedAt);
  const newest = new Map<string, (typeof events)[number]>();
  for (const event of events) if (!newest.has(event.key)) newest.set(event.key, event);
  return [...newest.values()]
    .filter((event) => event.action === 'set')
    .slice(0, 12)
    .map(({ key, memory }) => ({ key, preference: memory.content }));
}

export async function saveDialoguePreference(
  store: Storage,
  user: Message,
  raw: unknown,
  redact: (value: unknown) => Promise<unknown>,
) {
  const change = preferenceChange.parse(raw);
  const content =
    change.action === 'set'
      ? z
          .string()
          .trim()
          .min(2)
          .max(200)
          .parse(await redact(change.preference))
      : '用户撤回了这一项聊天偏好';
  return store.atomic(async (tx) => {
    const latest = await tx.get('messages', user.id);
    if (
      !latest ||
      latest.role !== 'user' ||
      latest.characterId !== user.characterId ||
      latest.content !== user.content ||
      !latest.content.includes(change.quote)
    )
      throw new Error('这次消息里没有这条表达偏好的原话');
    if (!(await tx.get('characters', user.characterId))) throw new Error('角色不存在');

    const id = `dialogue-preference:${user.id}:${change.key}`;
    const prior = await tx.get('memories', id);
    if (prior) {
      const saved = eventSchema.parse(prior.metadata);
      return { action: saved.action, key: saved.key };
    }
    if (
      change.action === 'forget' &&
      !(await dialoguePreferences(tx, user.characterId)).some((item) => item.key === change.key)
    )
      throw new Error('这次要撤回的聊天偏好不在当前有效列表');
    await tx.put('memories', {
      id,
      characterId: user.characterId,
      type: 'relationship',
      source: user.id,
      content,
      importance: 0.95,
      createdAt: user.createdAt,
      updatedAt: Date.now(),
      accessCount: 0,
      metadata: {
        kind: 'dialogue_preference',
        key: change.key,
        action: change.action,
        messageAt: user.createdAt,
      },
    });
    return { action: change.action, key: change.key };
  });
}
