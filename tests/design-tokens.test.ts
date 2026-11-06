import { expect, it } from 'vitest';
import { designTokens } from '../src/theme/design-tokens';
import { visualThemes, visualThemePalette } from '../src/theme/visual-presets';
import { contrast } from '../src/theme/generator';
it('preserves brand primary colors and keeps every reading surface legible across four previews', () => {
  for (const theme of visualThemes) {
    const palette = visualThemePalette(theme.id),
      tokens = designTokens(palette);
    expect(tokens.primary).toBe(palette.accent);
    for (const role of [tokens.ai, tokens.user, tokens.recommendation, tokens.input])
      expect(contrast(role.text, role.background)).toBeGreaterThanOrEqual(4.5);
    for (const background of [tokens.background, tokens.card]) {
      expect(contrast(tokens.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.secondaryText, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(tokens.onPrimary, tokens.primary)).toBeGreaterThanOrEqual(4.5);
    expect(tokens.ai.background).not.toBe(tokens.user.background);
    expect(tokens.ai.background).not.toBe(tokens.recommendation.background);
    expect(tokens.recommendation.pressed).not.toBe(tokens.recommendation.background);
    expect(contrast(tokens.disabled.text, tokens.disabled.background)).toBeGreaterThanOrEqual(3);
  }
});
