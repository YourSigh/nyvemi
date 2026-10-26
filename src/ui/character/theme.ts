import { useMemo } from 'react';
import { characterTheme } from '../../character/theme';
import { usePalette } from '../../theme/context';
export function useCharacterTheme() {
  const palette = usePalette();
  return useMemo(() => characterTheme(palette), [palette]);
}
