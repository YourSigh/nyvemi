import type { Palette } from '../theme/model';
export interface CharacterTheme {
  background: string;
  surface: string;
  primary: string;
  primarySoft: string;
  text: string;
  textSecondary: string;
  border: string;
  characterGlow: string;
  error: string;
  characterFace: string;
  characterEye: string;
  characterHighlight: string;
  characterBlush: string;
}
/** Screen semantics share the app palette; neutral illustration materials are centralized here. */
export function characterTheme(palette: Palette): CharacterTheme {
  return {
    background: palette.background,
    surface: palette.paper,
    primary: palette.accent,
    primarySoft: palette.tint,
    text: palette.ink,
    textSecondary: palette.muted,
    border: palette.line,
    characterGlow: palette.tint,
    error: palette.error,
    characterFace: '#FFF0E4',
    characterEye: '#49353F',
    characterHighlight: '#FFFFFF',
    characterBlush: palette.tint,
  };
}
