import { it, expect } from 'vitest';
import { imageSecrets } from '../src/appearance/secrets';
it('binds the secure image key to its HTTPS provider origin', async () => {
  let raw: string | null = null;
  const secret = imageSecrets({
    get: async () => raw,
    set: async (value) => {
      raw = value;
    },
    remove: async () => {
      raw = null;
    },
  });
  await secret.set('key', 'https://ark.cn-beijing.volces.com/api/v3');
  expect(await secret.get('https://ark.cn-beijing.volces.com/api/v3')).toBe('key');
  expect(await secret.get('https://untrusted.example/api/v3')).toBeNull();
});
