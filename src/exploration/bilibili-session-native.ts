import { fetch as nativeFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { BilibiliSessionManager } from './bilibili-session';

const sessionKey = 'nyvemi.bilibili.session';

function getSetCookies(response: Response): string[] {
  // Expo SDK 55 exposes the Android OkHttp response headers as ordered pairs, preserving duplicates.
  const raw = (response as Response & { readonly _rawHeaders?: unknown })._rawHeaders;
  if (!Array.isArray(raw)) return response.headers.getSetCookie?.() ?? [];
  return raw.flatMap((header: unknown) =>
    Array.isArray(header) &&
    typeof header[0] === 'string' &&
    header[0].toLowerCase() === 'set-cookie' &&
    typeof header[1] === 'string'
      ? [header[1]]
      : [],
  );
}

export function createBilibiliSessionManager(): BilibiliSessionManager {
  return new BilibiliSessionManager({
    request: nativeFetch as unknown as typeof fetch,
    getSetCookies,
    secureStore: {
      get: () => SecureStore.getItemAsync(sessionKey),
      set: (value) =>
        SecureStore.setItemAsync(sessionKey, value, {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        }),
      remove: () => SecureStore.deleteItemAsync(sessionKey),
    },
  });
}
