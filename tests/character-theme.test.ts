import { expect, it } from 'vitest';
import { characterTheme } from '../src/character/theme';
import { defaultPreference } from '../src/theme/model';
import { generatePalette, contrast } from '../src/theme/generator';
it('links every chat surface to the current generated theme in light and dark modes', () => {
  for (const brightness of ['light', 'dark'] as const)
    for (const base of ['pink', 'blue', 'mint', 'neutral'] as const) {
      const palette = generatePalette({ ...defaultPreference, base, brightness });
      const theme = characterTheme(palette);
      expect(theme.primary).toBe(palette.accent);
      expect(theme.primarySoft).toBe(palette.tint);
      expect(theme.characterGlow).toBe(palette.tint);
      expect(contrast(theme.text, theme.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.text, theme.primarySoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.characterEye, theme.characterFace)).toBeGreaterThanOrEqual(4.5);
    }
});
