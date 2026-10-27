import type { Storage } from '../storage/store';
export interface ModelUpgradeIO {
  read(uri: string): Promise<Uint8Array>;
  digest(bytes: Uint8Array): Promise<string>;
  write(characterId: string, bytes: Uint8Array): Promise<string>;
  remove(uri: string): Promise<void>;
}
// Only byte-identical built-in samples are eligible. Imported/edited models are retained.
export async function upgradeKnownModels(
  store: Storage,
  io: ModelUpgradeIO,
  known: { length: number; digest: string }[],
  replacement: () => Promise<Uint8Array>,
) {
  let bytes: Uint8Array | undefined;
  const resolved = new Map<string, string | undefined>();
  const upgrade = async (cid: string, uri: string) => {
    if (resolved.has(uri)) return resolved.get(uri);
    const old = await io.read(uri).catch(() => undefined);
    if (!old || !known.some((k) => k.length === old.length)) {
      resolved.set(uri, undefined);
      return;
    }
    const hash = await io.digest(old);
    if (!known.some((k) => k.length === old.length && k.digest === hash)) {
      resolved.set(uri, undefined);
      return;
    }
    bytes ??= await replacement();
    const next = await io.write(cid, bytes);
    resolved.set(uri, next);
    return next;
  };
  const written = new Set<string>();
  try {
    for (const c of await store.list('characters', undefined, 100000)) {
      if (!c.meshAvatar) continue;
      const old = c.meshAvatar.uri,
        next = await upgrade(c.id, old);
      if (!next) continue;
      written.add(next);
      await store.atomic(async (tx) => {
        const fresh = await tx.get('characters', c.id);
        if (fresh?.meshAvatar?.uri === old)
          await tx.put('characters', { ...fresh, meshAvatar: { ...fresh.meshAvatar, uri: next } });
      });
    }
    for (const d of await store.list('visualDrafts', undefined, 100000)) {
      if (!d.meshAvatar) continue;
      const old = d.meshAvatar.uri,
        next = await upgrade(d.characterId, old);
      if (!next) continue;
      written.add(next);
      await store.atomic(async (tx) => {
        const fresh = await tx.get('visualDrafts', d.id);
        if (fresh?.meshAvatar?.uri === old)
          await tx.put('visualDrafts', {
            ...fresh,
            meshAvatar: { ...fresh.meshAvatar, uri: next },
          });
      });
    }
  } catch (error) {
    // Keep successful references intact if a later row fails; remove only truly unreferenced outputs.
    const used = new Set([
      ...(await store.list('characters', undefined, 100000)).map((c) => c.meshAvatar?.uri),
      ...(await store.list('visualDrafts', undefined, 100000)).map((d) => d.meshAvatar?.uri),
    ]);
    for (const uri of written) if (!used.has(uri)) await io.remove(uri).catch(() => undefined);
    throw error;
  }
}
