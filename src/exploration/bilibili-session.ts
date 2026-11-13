import type { SecretStore } from '../providers/provider';

const passport = 'https://passport.bilibili.com/x/passport-login/web/qrcode/';
const apiOrigin = 'https://api.bilibili.com';
const scanOrigin = 'https://account.bilibili.com';
const qrLifetime = 3 * 60 * 1000;
const pollInterval = 2 * 1000;
const sessionFallbackLifetime = 24 * 60 * 60 * 1000;
const maximumSessionLifetime = 180 * sessionFallbackLifetime;
const loginTimeout = 12 * 1000;
const keyPattern = /^[a-z\d]{32}$/i;
const bvidPattern = /^BV[A-Za-z0-9]{10}$/;
const cookieValuePattern = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]{1,2048}$/;
const restrictedHttpStatuses = [401, 403, 412, 429, 451];
const restrictedApiCodes = [-101, -111, -352, -401, -403, -412, -429, -451, -509, -799];

export type BilibiliSessionStatus = 'signed_out' | 'signed_in';
export type BilibiliQrOutcome = 'waiting' | 'scanned' | 'expired' | 'signed_in';
export interface BilibiliQrCode {
  key: string;
  url: string;
  expiresAt: number;
}
type SessionErrorCode =
  | 'unavailable'
  | 'blocked'
  | 'invalid_response'
  | 'session_unavailable'
  | 'storage';

export class BilibiliSessionError extends Error {
  constructor(readonly code: SessionErrorCode) {
    super(`bilibili_session_${code}`);
    this.name = 'BilibiliSessionError';
  }
}

interface BilibiliSessionOptions {
  request: typeof fetch;
  secureStore: SecretStore;
  getSetCookies?: (response: Response) => readonly string[];
  now?: () => number;
}

interface Session {
  value: string;
  expiresAt: number;
}

interface ActiveQr extends BilibiliQrCode {
  outcome: 'waiting' | 'scanned';
  nextPollAt: number;
  polling: boolean;
}

function abortError() {
  const error = new Error('bilibili_session_cancelled');
  error.name = 'AbortError';
  return error;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new BilibiliSessionError('invalid_response');
  return value as Record<string, unknown>;
}

function parsedUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 1500)
    throw new BilibiliSessionError('invalid_response');
  try {
    return new URL(value);
  } catch {
    throw new BilibiliSessionError('invalid_response');
  }
}

function onlyParameters(url: URL, names: readonly string[]) {
  const seen = new Set<string>();
  let valid = true;
  url.searchParams.forEach((_, name) => {
    if (!names.includes(name) || seen.has(name)) valid = false;
    seen.add(name);
  });
  return valid && seen.size === names.length;
}

function parseQr(value: unknown, expiresAt: number): BilibiliQrCode {
  const data = record(value);
  const key = data.qrcode_key;
  if (typeof key !== 'string' || !keyPattern.test(key))
    throw new BilibiliSessionError('invalid_response');
  const url = parsedUrl(data.url);
  if (
    url.origin !== scanOrigin ||
    url.pathname !== '/h5/account-h5/auth/scan-web' ||
    url.username ||
    url.password ||
    url.hash ||
    !onlyParameters(url, ['navhide', 'callback', 'qrcode_key', 'from']) ||
    url.searchParams.get('callback') !== 'close' ||
    url.searchParams.get('qrcode_key') !== key
  )
    throw new BilibiliSessionError('invalid_response');
  return { key, url: url.href, expiresAt };
}

function sessionCookie(headers: readonly string[], now: number): Session {
  const cookies = headers
    .filter((header) => /^\s*SESSDATA=/.test(header))
    .map((header) => header.split(';').map((part) => part.trim()));
  if (cookies.length !== 1) throw new BilibiliSessionError('invalid_response');
  const [cookie, ...attributes] = cookies[0];
  const value = cookie.slice('SESSDATA='.length);
  if (!cookieValuePattern.test(value)) throw new BilibiliSessionError('invalid_response');
  const attrs = new Map(
    attributes.map((attribute) => {
      const at = attribute.indexOf('=');
      return at < 0
        ? [attribute.toLowerCase(), '']
        : [attribute.slice(0, at).toLowerCase(), attribute.slice(at + 1)];
    }),
  );
  if (!/^\.?bilibili\.com$/i.test(attrs.get('domain') ?? '') || attrs.get('path') !== '/')
    throw new BilibiliSessionError('invalid_response');
  const maxAge = attrs.get('max-age');
  const expires = attrs.get('expires');
  const upstreamExpiry =
    maxAge !== undefined
      ? /^-?\d+$/.test(maxAge)
        ? now + Number(maxAge) * 1000
        : NaN
      : expires !== undefined
        ? Date.parse(expires)
        : now + sessionFallbackLifetime;
  if (!Number.isFinite(upstreamExpiry) || upstreamExpiry <= now)
    throw new BilibiliSessionError('invalid_response');
  return { value, expiresAt: Math.min(upstreamExpiry, now + maximumSessionLifetime) };
}

function authorizeRoute(request: URL): URL {
  const url = parsedUrl(request.href);
  if (url.origin !== apiOrigin || url.username || url.password || url.hash)
    throw new BilibiliSessionError('invalid_response');
  const bvid = bvidPattern.test(url.searchParams.get('bvid') ?? '');
  switch (url.pathname) {
    case '/x/player/v2':
      if (
        onlyParameters(url, ['bvid', 'cid']) &&
        bvid &&
        /^[1-9]\d{0,15}$/.test(url.searchParams.get('cid') ?? '')
      )
        return url;
      break;
    case '/x/web-interface/view':
      if (onlyParameters(url, ['bvid']) && bvid) return url;
      break;
    case '/x/web-interface/popular': {
      const page = url.searchParams.get('pn') ?? '';
      const size = url.searchParams.get('ps') ?? '';
      if (
        onlyParameters(url, ['pn', 'ps']) &&
        /^[1-9]\d?$/.test(page) &&
        Number(page) <= 10 &&
        /^[1-9]\d?$/.test(size) &&
        Number(size) <= 50
      )
        return url;
      break;
    }
    case '/x/web-interface/ranking/v2':
      if (
        onlyParameters(url, ['rid', 'type']) &&
        ['1', '4', '36', '188'].includes(url.searchParams.get('rid') ?? '') &&
        url.searchParams.get('type') === 'all'
      )
        return url;
      break;
  }
  throw new BilibiliSessionError('invalid_response');
}

async function readLoginData(response: Response): Promise<Record<string, unknown>> {
  const maxBytes = 16 * 1024;
  if (Number(response.headers.get('content-length')) > maxBytes)
    throw new BilibiliSessionError('invalid_response');
  const reader = response.body?.getReader();
  let text: string;
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    text = '';
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new BilibiliSessionError('invalid_response');
        }
        text += decoder.decode(next.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  } else {
    text = await response.text();
    if (text.length > maxBytes) throw new BilibiliSessionError('invalid_response');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BilibiliSessionError('invalid_response');
  }
  const envelope = record(parsed);
  if (typeof envelope.code === 'number' && restrictedApiCodes.includes(envelope.code))
    throw new BilibiliSessionError('blocked');
  if (envelope.code !== 0) throw new BilibiliSessionError('invalid_response');
  return record(envelope.data);
}

export class BilibiliSessionManager {
  private qr?: ActiveQr;
  private generation = 0;
  private sessionGeneration = 0;
  private storageQueue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;

  constructor(private options: BilibiliSessionOptions) {
    this.now = options.now ?? Date.now;
  }

  async getStatus(): Promise<BilibiliSessionStatus> {
    return (await this.inStorageQueue(() => this.readSession())) ? 'signed_in' : 'signed_out';
  }

  async beginQr(signal?: AbortSignal): Promise<BilibiliQrCode> {
    this.cancelQr();
    const generation = this.generation;
    const url = new URL('generate', passport);
    const qr = await this.loginRequest(url, signal, async (response) =>
      parseQr(await readLoginData(response), this.now() + qrLifetime),
    );
    if (this.generation !== generation || signal?.aborted) throw abortError();
    this.qr = { ...qr, outcome: 'waiting', nextPollAt: 0, polling: false };
    return qr;
  }

  async pollQr(key: string, signal?: AbortSignal): Promise<BilibiliQrOutcome> {
    const qr = this.qr;
    if (!qr || qr.key !== key) return 'expired';
    if (this.now() >= qr.expiresAt) {
      this.cancelQr(key);
      return 'expired';
    }
    if (signal?.aborted) throw abortError();
    if (qr.polling || this.now() < qr.nextPollAt) return qr.outcome;
    const url = new URL('poll', passport);
    url.searchParams.set('qrcode_key', qr.key);
    qr.polling = true;
    qr.nextPollAt = this.now() + pollInterval;
    try {
      const result = await this.loginRequest(url, signal, async (response) => {
        const data = await readLoginData(response);
        if (data.code === 86101) return 'waiting';
        if (data.code === 86090) return 'scanned';
        if (data.code === 86038) return 'expired';
        if (data.code === 0)
          return sessionCookie(
            this.options.getSetCookies?.(response) ?? response.headers.getSetCookie?.() ?? [],
            this.now(),
          );
        if (typeof data.code === 'number' && restrictedApiCodes.includes(data.code))
          throw new BilibiliSessionError('blocked');
        throw new BilibiliSessionError('invalid_response');
      });
      if (signal?.aborted || qr !== this.qr) throw abortError();
      if (this.now() >= qr.expiresAt || result === 'expired') {
        this.cancelQr(key);
        return 'expired';
      }
      if (typeof result === 'string') {
        qr.outcome = result;
        return result;
      }
      return await this.inStorageQueue<'signed_in'>(async () => {
        if (signal?.aborted || qr !== this.qr) throw abortError();
        await this.options.secureStore.set(JSON.stringify(result));
        if (signal?.aborted || qr !== this.qr) {
          await this.options.secureStore.remove();
          throw abortError();
        }
        this.sessionGeneration++;
        this.cancelQr(key);
        return 'signed_in';
      });
    } catch (error) {
      if (
        error instanceof BilibiliSessionError &&
        ['blocked', 'invalid_response'].includes(error.code)
      )
        this.cancelQr(key);
      throw error;
    } finally {
      qr.polling = false;
    }
  }

  cancelQr(key?: string): void {
    if (key !== undefined && this.qr?.key !== key) return;
    this.qr = undefined;
    this.generation++;
  }

  async signOut(): Promise<void> {
    this.cancelQr();
    this.sessionGeneration++;
    await this.inStorageQueue(() => this.options.secureStore.remove());
  }

  async readAuthorized(request: URL, signal: AbortSignal): Promise<Response> {
    const url = authorizeRoute(request);
    if (signal.aborted) throw abortError();
    const generation = this.sessionGeneration;
    const session = await this.inStorageQueue(() => this.readSession());
    if (!session) throw new BilibiliSessionError('session_unavailable');
    if (generation !== this.sessionGeneration) throw abortError();
    const response = await this.request(url, signal, session);
    if (generation !== this.sessionGeneration) {
      await response.body?.cancel().catch(() => undefined);
      throw abortError();
    }
    return response;
  }

  private async request(url: URL, signal: AbortSignal, session?: Session): Promise<Response> {
    if (signal.aborted) throw abortError();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (session) headers.Cookie = `SESSDATA=${session.value}`;
    let response: Response;
    try {
      response = await this.options.request(url.href, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        headers,
        signal,
      });
    } catch {
      if (signal.aborted) throw abortError();
      throw new BilibiliSessionError('unavailable');
    }
    if (signal.aborted) throw abortError();
    if (response.redirected || parsedUrl(response.url).href !== url.href)
      throw new BilibiliSessionError('invalid_response');
    return response;
  }

  private async loginRequest<T>(
    url: URL,
    signal: AbortSignal | undefined,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw abortError();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, loginTimeout);
    try {
      const response = await this.request(url, controller.signal);
      if (restrictedHttpStatuses.includes(response.status))
        throw new BilibiliSessionError('blocked');
      if (!response.ok) throw new BilibiliSessionError('unavailable');
      const result = await read(response);
      if (controller.signal.aborted) throw abortError();
      return result;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (error instanceof BilibiliSessionError) throw error;
      throw new BilibiliSessionError('unavailable');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  private inStorageQueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.storageQueue.then(work).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new BilibiliSessionError('storage');
    });
    this.storageQueue = result.catch(() => {});
    return result;
  }

  private async readSession(): Promise<Session | undefined> {
    const stored = await this.options.secureStore.get();
    if (!stored) return;
    try {
      const session = JSON.parse(stored) as Partial<Session> | null;
      if (
        session &&
        typeof session.value === 'string' &&
        cookieValuePattern.test(session.value) &&
        typeof session.expiresAt === 'number' &&
        Number.isFinite(session.expiresAt) &&
        session.expiresAt > this.now()
      )
        return { value: session.value, expiresAt: session.expiresAt };
    } catch {
      // Discard malformed stored sessions without exposing their contents.
    }
    await this.options.secureStore.remove();
  }
}
