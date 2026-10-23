import {
  defaultPreference,
  ThemePreferenceSchema,
  type Palette,
  type ThemePreference,
} from './model';
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
export function generatePalette(input: ThemePreference): Palette {
  const p = ThemePreferenceSchema.parse(input);
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
  return `${p.brightness === 'dark' ? '夜色 · ' : ''}${names[p.base]}${p.mood === 'dreamy' ? '微梦' : p.mood === 'playful' ? '晴天' : p.mood === 'minimal' ? '留白' : '小憩'}`;
}
// Keep the existing pink-white default while making small captions readable.
export const defaultPalette: Palette = {
  ...generatePalette(defaultPreference),
  background: '#FFF7FA',
  paper: '#FFFFFF',
  ink: '#49353F',
  muted: '#775865',
  accent: '#A33362',
  onAccent: '#FFFFFF',
  tint: '#FCE4EE',
  line: '#F2DCE6',
  error: '#AA405D',
};
