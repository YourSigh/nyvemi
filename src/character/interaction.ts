import { z } from 'zod';
export const characterStates = [
  'idle',
  'listening',
  'thinking',
  'talking',
  'happy',
  'excited',
  'sad',
  'angry',
  'shy',
  'sleepy',
] as const;
export type CharacterInteractionState = (typeof characterStates)[number];
export const EmotionSchema = z.enum([
  'amused',
  'curious',
  'excited',
  'annoyed',
  'embarrassed',
  'sad',
  'calm',
  'tired',
]);
export type Emotion = z.infer<typeof EmotionSchema>;
export const expressionFields = {
  emotion: EmotionSchema.optional().catch(undefined),
  intensity: z.number().min(0).max(1).optional().catch(undefined),
};
export interface Expression {
  emotion?: Emotion;
  intensity?: number;
}
export type ChatActivity =
  | { phase: 'thinking' | 'talking' | 'error' }
  | ({ phase: 'complete'; hasMessages: boolean } & Expression);
const emotions: Record<Emotion, CharacterInteractionState> = {
  amused: 'happy',
  curious: 'thinking',
  excited: 'excited',
  annoyed: 'angry',
  embarrassed: 'shy',
  sad: 'sad',
  calm: 'idle',
  tired: 'sleepy',
};
/** Semantic state only. Renderers own the actual movements. */
export class CharacterStateMapper {
  static emotion(expression: Expression): CharacterInteractionState {
    return expression.intensity === 0 || !expression.emotion
      ? 'idle'
      : emotions[expression.emotion];
  }
  static state(activity: ChatActivity | undefined, typing: boolean): CharacterInteractionState {
    if (activity?.phase === 'thinking' || activity?.phase === 'talking') return activity.phase;
    if (activity?.phase === 'complete' && activity.hasMessages) {
      const emotion = this.emotion(activity);
      if (emotion !== 'idle') return emotion;
    }
    return typing ? 'listening' : 'idle';
  }
}
export class ChatActivityBus {
  private listeners = new Map<string, Set<(activity: ChatActivity) => void>>();
  subscribe(characterId: string, listener: (activity: ChatActivity) => void) {
    const group = this.listeners.get(characterId) ?? new Set();
    group.add(listener);
    this.listeners.set(characterId, group);
    return () => {
      group.delete(listener);
      if (!group.size) this.listeners.delete(characterId);
    };
  }
  publish(characterId: string, activity: ChatActivity) {
    for (const listener of this.listeners.get(characterId) ?? []) {
      try {
        listener(activity);
      } catch {
        /* An observer cannot fail the conversation. */
      }
    }
  }
}
