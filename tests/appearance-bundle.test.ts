import { expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { exportLook, importLook } from '../src/appearance/bundle';
import { mockRig } from '../src/appearance/mock';
it('transfers only the layered artwork without a character or key', async () => {
  const rig = mockRig('blue');
  const bytes = await exportLook(rig, async () => {
    throw new Error('not needed');
  });
  const next = await importLook(
    bytes,
    async () => {
      throw new Error('not needed');
    },
    async () => {},
  );
  expect(next).toEqual(rig);
});
it('rolls back imported raster files if a later write fails', async () => {
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN0AAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const rig = mockRig('x');
  rig.source = 'seedream';
  rig.layers = rig.layers.map((l, i) => ({
    ...l,
    asset: { uri: `file://layer${i}`, width: 1, height: 1 },
  }));
  const bytes = await exportLook(rig, async () => png);
  const removed: string[] = [];
  let calls = 0;
  await expect(
    importLook(
      bytes,
      async () => {
        if (++calls === 2) throw new Error('disk full');
        return 'file://new';
      },
      async (uri) => {
        removed.push(uri);
      },
    ),
  ).rejects.toThrow('disk full');
  expect(removed).toEqual(['file://new']);
});
it('rejects traversal and incomplete rigs before any files are written', async () => {
  const bytes = zipSync({ '../private': strToU8('x') });
  await expect(
    importLook(
      bytes,
      async () => '',
      async () => {},
    ),
  ).rejects.toThrow('非法');
});
