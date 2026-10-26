import type { ImageAsset } from './model';
import type { Storage } from '../storage/store';
// Called while holding visual-assets lease, after removing a character's database rows.
export async function pruneVisualAssets(
  store: Storage,
  io: { list(): Promise<string[]>; remove(uri: string): Promise<void> },
) {
  const pinned = new Set<string>();
  const pin = (a?: ImageAsset) => {
    if (a && !a.svg) pinned.add(a.uri);
  };
  for (const c of await store.list('characters', undefined, 100000)) {
    if (c.meshAvatar) pinned.add(c.meshAvatar.uri);
    for (const l of c.rig?.layers ?? []) pin(l.asset);
  }
  for (const d of await store.list('visualDrafts', undefined, 100000)) {
    if (d.meshAvatar) pinned.add(d.meshAvatar.uri);
    pin(d.input.reference);
    pin(d.selected);
    d.candidates.forEach(pin);
    for (const l of d.rig?.layers ?? []) pin(l.asset);
  }
  for (const request of await store.list('imageRequests', undefined, 100000)) {
    if (!request.result) continue; // Preserve ambiguous paid request receipts.
    const assets =
      'layers' in request.result ? request.result.layers.map((l) => l.asset) : [request.result];
    if (assets.every((a) => a.svg || !pinned.has(a.uri)))
      await store.remove('imageRequests', request.id);
  }
  for (const uri of await io.list()) if (!pinned.has(uri)) await io.remove(uri);
}
