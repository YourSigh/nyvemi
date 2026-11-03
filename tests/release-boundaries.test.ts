import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}
it('production source contains no authored demo persona or developer artwork references', () => {
  for (const path of ['App.tsx', ...sources('src')]) {
    const source = readFileSync(path, 'utf8');
    expect(source, path).not.toMatch(/桶砸|tongza|demoPersona|dev-assets/i);
  }
  expect(readFileSync('dev-assets/characters/tongza.p2lrt').length).toBeGreaterThan(100_000);
  expect(readFileSync('metro.config.js', 'utf8')).toContain('dev-assets');
});
