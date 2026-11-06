import { expect, it } from 'vitest';
import { characterChatLayout, initialCharacterSize } from '../src/character/layout';
it('caps a normal character region at 230–250dp across phone widths, leaving growth to conversation', () => {
  for (const width of [280, 320, 360, 390, 430, 600])
    for (const h of [640, 760, 900, 1200])
      for (const composer of [72, 136, 180]) {
        const p = characterChatLayout(h, composer, width);
        expect(p.character).toBeGreaterThanOrEqual(230);
        expect(p.character).toBeLessThanOrEqual(250);
        expect(p.chat).toBeGreaterThanOrEqual(140);
        expect(p.header + p.character + p.chat + p.composer).toBeCloseTo(h);
      }
  expect(characterChatLayout(1200).character).toBe(characterChatLayout(900).character);
});
it('keeps both character and conversation visible with the keyboard or a multiline composer', () => {
  for (const h of [300, 380, 440])
    for (const composer of [72, 112]) {
      const p = characterChatLayout(h, composer);
      expect(p.character).toBeGreaterThan(50);
      expect(p.character).toBeLessThan(230);
      expect(p.chat).toBeGreaterThan(50);
      expect(p.header + p.character + p.chat + p.composer).toBeCloseTo(h);
    }
});
it('keeps the complete painting large enough normally and within either axis on narrow/keyboard viewports', () => {
  for (const width of [180, 280, 320, 390, 600])
    for (const height of [72, 110, 230, 240, 250]) {
      const size = initialCharacterSize(height, width);
      expect(size + 12).toBeLessThanOrEqual(height);
      expect(size + 24).toBeLessThanOrEqual(width);
      if (height >= 230 && width >= 280) {
        expect(size).toBeGreaterThanOrEqual(218);
        expect(size / 245).toBeGreaterThanOrEqual(0.88);
        expect(size / 245).toBeLessThanOrEqual(0.93);
      }
    }
  expect(initialCharacterSize(0, 0)).toBe(0);
});
it('explicitly shrinks while the keyboard is open even if the measured viewport stays tall', () => {
  for (const height of [440, 600, 760, 900]) {
    const open = characterChatLayout(height, 136, 390, true);
    expect(open.character).toBeLessThanOrEqual(145);
    expect(open.chat).toBeGreaterThanOrEqual(50);
    if (height >= 600)
      expect(open.character).toBeLessThan(characterChatLayout(height, 136, 390).character * 0.65);
  }
});
