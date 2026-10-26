import { expect, it } from 'vitest';
import { characterChatLayout } from '../src/character/layout';
it('gives the character one third of the phone and more room to conversation', () => {
  for (const h of [640, 760, 900, 1200]) {
    const p = characterChatLayout(h);
    expect(p.character / h).toBeGreaterThanOrEqual(0.30);
    expect(p.character / h).toBeLessThanOrEqual(0.35);
    expect(p.chat).toBeGreaterThan(p.character);
    expect(p.header + p.character + p.chat + p.composer).toBeCloseTo(h);
  }
});
it('keeps both character and conversation visible with the keyboard or a multiline composer', () => {
  for (const h of [300, 380, 440])
    for (const composer of [72, 112]) {
      const p = characterChatLayout(h, composer);
      expect(p.character).toBeGreaterThan(50);
      expect(p.chat).toBeGreaterThan(50);
      expect(p.header + p.character + p.chat + p.composer).toBeCloseTo(h);
    }
});
