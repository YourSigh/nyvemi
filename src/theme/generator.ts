import { brandColors, type BrandThemeId } from './brand-colors';
import { ThemePreferenceSchema, type Palette, type ThemePreference } from './model';
export function hsl(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
function luminance(hex: string): number {
  const values = [1, 3, 5].map((index) => {
    const c = parseInt(hex.slice(index, index + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
export function contrast(a: string, b: string): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function blend(a: string, b: string, weight: number) {
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
export function brandPalette(id: BrandThemeId): Palette {
  const p = brandColors[id],
    surfaces = [p.background, p.paper, p.tint, p.user];
  const readable = (color: string) => {
    for (let n = 0; n <= 100; n++) {
      const value = blend(color, p.ink, n / 100);
      if (surfaces.every((surface) => contrast(value, surface) >= 4.5)) return value;
    }
    return p.ink;
  };
  const accent = readable(p.action);
  const foreground = (background: string) =>
    [p.ink, p.background, '#FFFFFF', '#000000'].find(
      (value) => contrast(value, background) >= 4.5,
    )!;
  return {
    background: p.background,
    paper: p.paper,
    tint: p.tint,
    ink: p.ink,
    brandPrimary: p.primary,
    action: p.action,
    onAction: foreground(p.action),
    userBubble: p.user,
    support: p.support,
    accent,
    onAccent: foreground(accent),
    muted: readable(blend(p.ink, p.background, 0.48)),
    line: blend(p.background, p.ink, 0.15),
    error: readable(id === 'nebula' ? '#F4A3B8' : '#A82F58'),
  };
}
export function brandForPreference(p: ThemePreference): BrandThemeId | undefined {
  if (p.brightness === 'dark')
    return p.base === 'blue' || p.base === 'purple' ? 'nebula' : undefined;
  return p.base === 'pink'
    ? 'sakura'
    : p.base === 'purple'
      ? 'moonlight'
      : p.base === 'mint'
        ? 'mint'
        : undefined;
}
export function generatePalette(input: ThemePreference): Palette {
  const p = ThemePreferenceSchema.parse(input);
  const brand = brandForPreference(p);
  if (brand) return brandPalette(brand);
  const dark = p.brightness === 'dark';
  const hues = {
    pink: 337,
    blue: 215,
    purple: 273,
    peach: 19,
    mint: 158,
    red: 358,
    amber: 39,
    neutral: 240,
  };
  const hue =
    (hues[p.base] + (p.temperature === 'warm' ? 4 : p.temperature === 'cool' ? -4 : 0) + 360) % 360;
  const saturation = p.base === 'neutral' ? 0.035 : p.saturation === 'low' ? 0.3 : 0.55;
  const background = hsl(hue, saturation * 0.5, dark ? 0.075 : 0.98);
  const paper = dark ? hsl(hue, saturation * 0.4, 0.12) : '#FFFFFF';
  const tint = hsl(hue, saturation * 0.8, dark ? 0.2 : 0.92);
  const surfaces = [background, paper, tint];
  const readable = (h: number, s: number, initial: number) => {
    for (let n = 0; n <= 100; n++) {
      const lightness = dark ? Math.min(1, initial + n * 0.01) : Math.max(0, initial - n * 0.01);
      const value = hsl(h, s, lightness);
      if (surfaces.every((surface) => contrast(value, surface) >= 4.5)) return value;
    }
    return dark ? '#FFFFFF' : '#000000';
  };
  const accent = readable(hue, saturation, dark ? 0.72 : 0.44);
  return {
    background,
    paper,
    tint,
    accent,
    ink: readable(hue, saturation * 0.3, dark ? 0.94 : 0.18),
    muted: readable(hue, saturation * 0.3, dark ? 0.7 : 0.4),
    onAccent: contrast(accent, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#101014',
    line: hsl(hue, saturation * 0.5, dark ? 0.29 : 0.85),
    error: readable(348, 0.55, dark ? 0.77 : 0.38),
  };
}
const names = {
  pink: '柔粉',
  blue: '雾蓝',
  purple: '浅紫',
  peach: '蜜桃',
  mint: '薄荷',
  red: '莓红',
  amber: '奶油',
  neutral: '素白',
};
export function themeName(p: ThemePreference): string {
  const brand = brandForPreference(p);
  if (brand)
    return {
      sakura: '樱雾 · Sakura Mist',
      moonlight: '月胚 · Moonlight',
      mint: '薄荷 · Mist Green',
      nebula: '星夜 · Nebula',
    }[brand];
  return `${p.brightness === 'dark' ? '夜色 · ' : ''}${names[p.base]}${p.mood === 'dreamy' ? '微梦' : p.mood === 'playful' ? '晴天' : p.mood === 'minimal' ? '留白' : '小憩'}`;
}
// Exact Sakura Mist brand colors are shared by first launch and later pink requests.
export const defaultPalette: Palette = brandPalette('sakura');
