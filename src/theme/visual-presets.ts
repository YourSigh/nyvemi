import { defaultPalette, generatePalette } from './generator';
import { defaultPreference, type Palette, type ThemePreference } from './model';
export const visualThemes = [
  {
    id: 'sakura',
    name: 'Sakura Mist',
    label: '樱雾',
    option: '樱雾 · 粉白',
    preference: defaultPreference,
  },
  {
    id: 'moonlight',
    name: 'Moonlight',
    label: '月胚',
    option: '月胚 · 淡紫',
    preference: { ...defaultPreference, base: 'purple', mood: 'dreamy', temperature: 'cool' },
  },
  {
    id: 'mint',
    name: 'Mist Green',
    label: '薄荷',
    option: '薄荷 · 清绿',
    preference: { ...defaultPreference, base: 'mint', mood: 'calm', temperature: 'cool' },
  },
  {
    id: 'nebula',
    name: 'Nebula',
    label: '星夜',
    option: '星夜 · 深色',
    preference: {
      ...defaultPreference,
      base: 'blue',
      mood: 'dreamy',
      brightness: 'dark',
      temperature: 'cool',
    },
  },
] as const satisfies readonly {
  id: string;
  name: string;
  label: string;
  option: string;
  preference: ThemePreference;
}[];
export type VisualThemeId = (typeof visualThemes)[number]['id'];
/** Shared production recipes: generated free-form colors use the same brand constraints. */
export function visualThemePalette(id: VisualThemeId): Palette {
  const preset = visualThemes.find((t) => t.id === id)!;
  return id === 'sakura' ? defaultPalette : generatePalette(preset.preference);
}
