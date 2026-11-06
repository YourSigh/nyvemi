import { defaultPalette, generatePalette } from './generator';
import { defaultPreference, type Palette, type ThemePreference } from './model';
export const visualThemes = [
  { id: 'sakura', name: 'Sakura Mist', label: '樱雾粉白', preference: defaultPreference },
  {
    id: 'moonlight',
    name: 'Moonlight',
    label: '淡紫月光',
    preference: { ...defaultPreference, base: 'purple', mood: 'dreamy', temperature: 'cool' },
  },
  {
    id: 'mint',
    name: 'Mist Green',
    label: '薄荷清雾',
    preference: { ...defaultPreference, base: 'mint', mood: 'calm', temperature: 'cool' },
  },
  {
    id: 'nebula',
    name: 'Nebula',
    label: '星夜微光',
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
  preference: ThemePreference;
}[];
export type VisualThemeId = (typeof visualThemes)[number]['id'];
/** Preview baseline only. Exact supplied HEX palettes must be confirmed before production rollout. */
export function visualThemePalette(id: VisualThemeId): Palette {
  const preset = visualThemes.find((t) => t.id === id)!;
  return id === 'sakura' ? defaultPalette : generatePalette(preset.preference);
}
