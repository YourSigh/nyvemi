/** User-supplied brand HEX values. Do not alter these to fix contrast: pair readable foregrounds instead. */
export const brandColors = {
  sakura: {
    background: '#FFFAFC',
    paper: '#FFFFFF',
    primary: '#E8A4BE',
    action: '#CE789B',
    tint: '#FFF1F6',
    user: '#FBE7EF',
    support: '#C9B7E9',
    ink: '#332D37',
  },
  moonlight: {
    background: '#FAF8FF',
    paper: '#FFFFFF',
    primary: '#A99AE8',
    action: '#8370D0',
    tint: '#F1EDFF',
    user: '#ECE7FF',
    support: '#B9C9FF',
    ink: '#302B43',
  },
  mint: {
    background: '#F7FBF9',
    paper: '#FFFFFF',
    primary: '#83C5B1',
    action: '#4F9F8B',
    tint: '#EEF8F3',
    user: '#E0F3EA',
    support: '#A9DDE6',
    ink: '#293B36',
  },
  nebula: {
    background: '#121426',
    paper: '#1B1E34',
    primary: '#AA9CFF',
    action: '#8D7CF0',
    tint: '#242842',
    user: '#353052',
    support: '#77CDE1',
    ink: '#F3F0FA',
  },
} as const;
export type BrandThemeId = keyof typeof brandColors;
