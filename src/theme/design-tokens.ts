import { contrast } from './generator';
import type { Palette } from './model';
/** Role-specific tokens. The brand's primary HEX is always preserved exactly. */
export function mix(a: string, b: string, amount: number): string {
  const weight = Math.max(0, Math.min(1, amount));
  return (
    '#' +
    [1, 3, 5]
      .map((n) =>
        Math.round(
          parseInt(a.slice(n, n + 2), 16) * (1 - weight) + parseInt(b.slice(n, n + 2), 16) * weight,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function designTokens(p: Palette) {
  return {
    background: p.background,
    card: p.paper,
    primary: p.brandPrimary ?? p.accent,
    onPrimary: p.onAction ?? p.onAccent,
    action: p.action ?? p.accent,
    emphasis: p.action ?? p.accent,
    text: p.ink,
    secondaryText: p.muted,
    border: p.line,
    error: p.error,
    ai: { background: mix(p.paper, p.tint, 0.22), text: p.ink, border: mix(p.paper, p.line, 0.68) },
    user: { background: p.userBubble ?? p.tint, text: p.ink, border: p.userBubble ?? p.tint },
    recommendation: {
      background: p.paper,
      text: p.accent,
      border: p.line,
      pressed: p.tint,
      selected: mix(p.paper, p.tint, 0.65),
    },
    input: {
      background: p.paper,
      text: p.ink,
      placeholder: p.muted,
      border: p.line,
      focusBorder: p.accent,
    },
    disabled: { background: mix(p.paper, p.line, 0.55), text: p.muted },
    interaction: {
      pressed: mix(
        p.action ?? p.accent,
        contrast(p.onAction ?? p.onAccent, '#FFFFFF') >=
          contrast(p.onAction ?? p.onAccent, '#000000')
          ? '#FFFFFF'
          : '#000000',
        0.12,
      ),
      secondaryPressed: p.tint,
      focus: p.accent,
    },
    character: { glow: p.tint, support: p.support ?? p.tint, rim: mix(p.accent, p.paper, 0.65) },
    radius: { card: 20, bubble: 18, recommendation: 12, input: 16, action: 14 },
  } as const;
}
export type DesignTokens = ReturnType<typeof designTokens>;
