/** Safe-area height, after keyboard avoidance. The character never disappears for long replies. */
export function characterChatLayout(height: number, composerHeight = 72) {
  const available = Math.max(0, height);
  const header = Math.min(56, Math.max(44, available * 0.07));
  const remaining = Math.max(0, available - header - composerHeight);
  const character = remaining * (available < 480 ? 0.48 : 0.58);
  return { header, character, chat: remaining - character, composer: composerHeight };
}
