import type { Storage } from '../storage/store';
import type { HatchingDraft } from './hatching';
import { typingDelay, waitForBubble, type SpeechDraft } from '../chat/delivery';
export const waitForTyping = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Error('开场发送已暂停'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(Error('开场发送已暂停'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
/** Persist the cursor and each visible bubble atomically, so resuming never dumps a whole batch. */
export async function deliverHatching(
  store: Storage,
  draft: HatchingDraft,
  updated: () => void,
  wait = waitForTyping,
  signal?: AbortSignal,
  onSpeechDraft?: SpeechDraft,
) {
  const outbox = draft.outbox;
  if (!outbox) return draft;
  let lastVisibleAt = (await store.list('messages', draft.characterId, 100))
    .filter((m) => m.status !== 'pending')
    .reduce((latest, m) => Math.max(latest, m.createdAt), 0);
  for (let n = outbox.delivered; n < outbox.messageIds.length; n++) {
    const message = await store.get('messages', outbox.messageIds[n]);
    if (!message) throw Error('开场消息缺失，请重新载入');
    if (message.status !== 'complete') {
      await waitForBubble(
        message.id,
        message.content,
        () => wait(typingDelay(message.content, n === 0, Date.now() - outbox.startedAt), signal),
        onSpeechDraft,
      );
      if (signal?.aborted) throw Error('开场发送已暂停');
    }
    draft = { ...draft, outbox: { ...outbox, delivered: n + 1 } };
    if (n === outbox.messageIds.length - 1) draft.outbox = undefined;
    lastVisibleAt = Math.max(Date.now(), message.createdAt, lastVisibleAt + 1);
    await store.atomic(async (tx) => {
      await tx.put('messages', {
        ...message,
        status: 'complete',
        createdAt: lastVisibleAt,
      });
      await tx.put('hatchings', draft);
    });
    updated();
  }
  return draft;
}
