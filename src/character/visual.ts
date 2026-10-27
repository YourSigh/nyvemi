import type { CharacterRig } from '../appearance/model';
import type { MeshAvatar } from '../avatar/model';
/** Mock art is a development fixture, never the user's automatic default body. */
export function hasCharacterVisual(
  visual: { meshAvatar?: MeshAvatar; rig?: CharacterRig } | undefined,
  allowMock = false,
): boolean {
  return Boolean(
    visual?.meshAvatar || (visual?.rig && (allowMock || visual.rig.source !== 'mock')),
  );
}
