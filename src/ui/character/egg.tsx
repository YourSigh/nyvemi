import { CocoonCharacter } from './cocoon';
import { useCharacterTheme } from './theme';
import type { CharacterInteractionState } from '../../character/interaction';
/** Existing egg identity remains compatible with saved characters; only its presentation changes. */
export function EggCharacter({
  height,
  state = 'idle',
}: {
  height: number;
  state?: CharacterInteractionState;
  progress?: number;
}) {
  const theme = useCharacterTheme();
  return <CocoonCharacter height={height} glow={theme.characterGlow} state={state} />;
}
