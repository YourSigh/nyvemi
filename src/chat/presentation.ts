import type { Message } from '../domain/models';
export function timeMarkers(messages: Message[]): Set<string> {
  const markers = new Set<string>();
  let previous: number | undefined;
  for (const message of messages) {
    if (
      previous === undefined ||
      message.createdAt - previous >= 5 * 60000 ||
      new Date(message.createdAt).toDateString() !== new Date(previous).toDateString()
    )
      markers.add(message.id);
    previous = message.createdAt;
  }
  return markers;
}
export function appendDictation(draft: string, result: string | null): string {
  if (!result?.trim()) return draft;
  return [draft.trimEnd(), result.trim()].filter(Boolean).join(' ').slice(0, 6000);
}
