import { expect, it } from 'vitest';
import { characterChatLayout } from '../src/character/layout';
it('keeps the character dominant at phone sizes while preserving a bounded chat viewport', () => {
  for (const h of [640, 760, 900, 1200]) {
    const p = characterChatLayout(h);
    expect(p.character / h).toBeGreaterThanOrEqual(0.45);
    expect(p.character / h).toBeLessThanOrEqual(0.55);
    expect(p.chat).toBeLessThan(p.character);
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
