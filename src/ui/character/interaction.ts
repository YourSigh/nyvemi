import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatService } from '../../chat/service';
import type { Message } from '../../domain/models';
import { CharacterStateMapper, type ChatActivity } from '../../character/interaction';
export function useCharacterInteraction(chat: ChatService, characterId: string, typing: boolean) {
  const [activity, setActivity] = useState<ChatActivity>();
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const incomingFinish = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);
  const update = useCallback((next: ChatActivity) => {
    clearTimeout(settle.current);
    clearTimeout(incomingFinish.current);
    busy.current = next.phase === 'thinking' || next.phase === 'talking';
    setActivity(next);
    if (next.phase === 'complete') settle.current = setTimeout(() => setActivity(undefined), 1400);
  }, []);
  useEffect(() => {
    setActivity(undefined);
    busy.current = false;
    const unsub = chat.subscribe(characterId, update);
    return () => {
      unsub();
      clearTimeout(settle.current);
      clearTimeout(incomingFinish.current);
    };
  }, [chat, characterId, update]);
  const incoming = useCallback(
    (message: Message) => {
      if (busy.current) return;
      update({ phase: 'talking' });
      incomingFinish.current = setTimeout(
        () =>
          update({
            phase: 'complete',
            hasMessages: true,
            emotion: message.emotion,
            intensity: message.intensity,
          }),
        Math.min(2800, 900 + message.content.length * 25),
      );
    },
    [update],
  );
  return {
    state: CharacterStateMapper.state(activity, typing),
    intensity: activity?.phase === 'complete' ? (activity.intensity ?? 0.5) : 0.4,
    incoming,
  };
}
