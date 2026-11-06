import { expect, it } from 'vitest';
import { designTokens } from '../src/theme/design-tokens';
import { visualThemes, visualThemePalette } from '../src/theme/visual-presets';
import { contrast } from '../src/theme/generator';
it('preserves brand primary colors and keeps every reading surface legible across four previews', () => {
  for (const theme of visualThemes) {
    const palette = visualThemePalette(theme.id),
      tokens = designTokens(palette);
    expect(tokens.primary).toBe(palette.brandPrimary ?? palette.accent);
    for (const role of [tokens.ai, tokens.user, tokens.recommendation, tokens.input])
      expect(contrast(role.text, role.background)).toBeGreaterThanOrEqual(4.5);
    for (const background of [tokens.background, tokens.card]) {
      expect(contrast(tokens.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.secondaryText, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(tokens.onPrimary, tokens.action)).toBeGreaterThanOrEqual(4.5);
    expect(tokens.ai.background).not.toBe(tokens.user.background);
    expect(tokens.ai.background).not.toBe(tokens.recommendation.background);
    expect(tokens.recommendation.pressed).not.toBe(tokens.recommendation.background);
    expect(contrast(tokens.disabled.text, tokens.disabled.background)).toBeGreaterThanOrEqual(3);
  }
});
it('uses the exact supplied HEX for all four themes and never changes a primary to solve text contrast', async () => {
  const { brandColors } = await import('../src/theme/brand-colors');
  for (const theme of visualThemes) {
    const expected = brandColors[theme.id],
      palette = visualThemePalette(theme.id),
      tokens = designTokens(palette);
    expect(tokens.background).toBe(expected.background);
    expect(tokens.card).toBe(expected.paper);
    expect(tokens.primary).toBe(expected.primary);
    expect(tokens.action).toBe(expected.action);
    expect(tokens.user.background).toBe(expected.user);
    expect(palette.tint).toBe(expected.tint);
    expect(tokens.character.support).toBe(expected.support);
    expect(tokens.text).toBe(expected.ink);
    expect(contrast(tokens.onPrimary, tokens.interaction.pressed)).toBeGreaterThanOrEqual(4.5);
  }
});
