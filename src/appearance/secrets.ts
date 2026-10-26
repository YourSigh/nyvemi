import { z } from 'zod';
import type { SecretStore } from '../providers/provider';
const BoundKey = z.object({ origin: z.string().url(), key: z.string().min(1) }).strict();
export function imageSecrets(storage: SecretStore) {
  return {
    async get(baseUrl?: string) {
      const raw = await storage.get();
      if (!raw) return null;
      const parsed = BoundKey.safeParse(JSON.parse(raw));
      if (!parsed.success) return null;
      if (baseUrl && new URL(baseUrl).origin !== parsed.data.origin) return null;
      return parsed.data.key;
    },
    async set(key: string, baseUrl: string) {
      await storage.set(JSON.stringify({ origin: new URL(baseUrl).origin, key }));
    },
  };
}
