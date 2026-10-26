// A deterministic timeline, shared by preview and tests. Breathing uses the existing Runtime.
export const awakeningDuration = 4800;
export function awakeningAt(elapsed: number) {
  return {
    eyesClosed: elapsed < 1400 || (elapsed >= 2100 && elapsed < 2250),
    state: elapsed >= 3000 ? ('happy' as const) : ('idle' as const),
    complete: elapsed >= awakeningDuration,
  };
}
