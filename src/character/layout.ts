/** Measured safe-area viewport, after keyboard avoidance. Extra screen height belongs to chat. */
export function characterChatLayout(
  height: number,
  composerHeight = 72,
  width = 390,
  keyboardVisible = false,
) {
  const available = Math.max(0, height);
  const header = Math.min(56, Math.max(44, available * 0.07));
  const remaining = Math.max(0, available - header - composerHeight);
  const normalTarget = Math.max(230, Math.min(250, Math.max(0, width) * 0.62));
  const target = keyboardVisible ? Math.min(normalTarget, 145) : normalTarget;
  // A keyboard/multiline composer may leave less room; never take the whole conversation viewport.
  const character = Math.min(
    target,
    !keyboardVisible && available >= 600 ? Math.max(0, remaining - 140) : remaining * 0.46,
  );
  return { header, character, chat: remaining - character, composer: composerHeight };
}
/** About 10% smaller than the former common ~245dp painting, without shrinking it twice. */
export function initialCharacterSize(height: number, width: number): number {
  return Math.max(0, Math.min(226, height - 12, width - 24));
}
