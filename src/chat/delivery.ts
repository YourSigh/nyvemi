/** Preserve code/list formatting; split prose paragraphs rather than every sentence. */
export function messageChunks(messages: string[]): string[] {
  const chunks = messages.flatMap((text) => {
    if (/```|^\s*(?:[-*•]|\d+[.)、])\s/m.test(text)) return [text.trim()];
    return text
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  });
  return chunks.length <= 12 ? chunks : [...chunks.slice(0, 11), chunks.slice(11).join(' ')];
}
/** Model/network time overlaps composing the first message, never all subsequent messages.
 * Fixed length-based rhythm avoids random silence/latency and caps unusually long replies. */
export function typingDelay(text: string, first: boolean, elapsed = 0): number {
  const units = Array.from(text).reduce(
    (sum, c) =>
      sum + (/\s/u.test(c) ? 0 : /[\p{Script=Han}\p{Emoji_Presentation}]/u.test(c) ? 1 : 0.45),
    0,
  );
  const target = Math.min(12000, 650 + units * 105);
  return Math.round(Math.max(first ? 350 : 650, target - (first ? Math.max(0, elapsed) : 0)));
}
