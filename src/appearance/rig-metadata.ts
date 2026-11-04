import type { CharacterRig } from './model';
import type { Storage } from '../storage/store';
export const isBackgroundPart = (name: string) => /\bbackground\b|背景/i.test(name);
/** Recover explicit provider labels from paid receipts without guessing from image colors. */
export async function restoreRigMetadata(store: Storage, rig: CharacterRig): Promise<CharacterRig> {
  if (rig.source !== 'seedream') return rig;
  let changed = false;
  const layers = await Promise.all(
    rig.layers.map(async (layer) => {
      if (layer.role !== 'detail') return layer;
      const match = /\/([a-f0-9]{64})-(\d+)\.png$/.exec(layer.asset.uri);
      if (!match) return layer;
      const receipt = await store.get('imageRequests', match[1]);
      const response = receipt?.response as
        | { data?: { name?: unknown; bounding_box?: { name?: unknown } }[] }
        | undefined;
      const item = Array.isArray(response?.data) ? response.data[Number(match[2])] : undefined;
      const name = item?.name ?? item?.bounding_box?.name;
      if (typeof name !== 'string' || !isBackgroundPart(name)) return layer;
      changed = true;
      return { ...layer, role: 'background' as const };
    }),
  );
  return changed ? { ...rig, layers } : rig;
}
export async function recoverRigMetadata(store: Storage) {
  for (const character of await store.list('characters', undefined, 100000)) {
    if (character.rig) {
      const rig = await restoreRigMetadata(store, character.rig);
      if (rig !== character.rig) await store.put('characters', { ...character, rig });
    }
    const draft = await store.get('visualDrafts', character.id);
    if (draft?.rig) {
      const rig = await restoreRigMetadata(store, draft.rig);
      if (rig !== draft.rig) await store.put('visualDrafts', { ...draft, rig });
    }
  }
}
