import { expect, it, vi } from 'vitest';
import { BilibiliSessionManager } from '../src/exploration/bilibili-session';

const qrKey = '123456789012345678901234567890ab';
const scan = `https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=${qrKey}&from=web`;
const player = new URL('https://api.bilibili.com/x/player/v2?bvid=BV1xE41187RJ&cid=126758089');
const cookie = 'SESSDATA=mock%2Ctest; Domain=.bilibili.com; Path=/; Max-Age=60; Secure; HttpOnly';
const login = {
  code: 0,
  data: { code: 0, url: 'https://example.invalid', refresh_token: 'ignore' },
};
const generated = { code: 0, data: { qrcode_key: qrKey, url: scan } };

function fixture() {
  let now = 1_800_000_000_000;
  let saved: string | null = null;
  const secureStore = {
    get: vi.fn(async () => saved),
    set: vi.fn(async (value: string) => {
      saved = value;
    }),
    remove: vi.fn(async () => {
      saved = null;
    }),
  };
  const request = vi.fn<typeof fetch>();
  const manager = new BilibiliSessionManager({ request, secureStore, now: () => now });
  const answer = (
    data: unknown,
    {
      status = 200,
      cookies = [],
      url,
      redirected = false,
    }: {
      status?: number;
      cookies?: string[];
      url?: string;
      redirected?: boolean;
    } = {},
  ) => {
    request.mockImplementationOnce(async (requestUrl) => {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      for (const cookie of cookies) headers.append('Set-Cookie', cookie);
      const response = new Response(JSON.stringify(data), { status, headers });
      Object.defineProperties(response, {
        url: { value: url ?? String(requestUrl) },
        redirected: { value: redirected },
      });
      return response;
    });
  };
  return {
    manager,
    answer,
    request,
    secureStore,
    tick: (delta: number) => {
      now += delta;
    },
  };
}

it('keeps QR guest and stores only the minimum session after official confirmation', async () => {
  const { manager, answer, request, secureStore, tick } = fixture();
  expect(await manager.getStatus()).toBe('signed_out');
  answer(generated);
  expect(await manager.beginQr()).toEqual({ key: qrKey, url: scan, expiresAt: 1_800_000_180_000 });
  answer({ code: 0, data: { code: 86101 } }, { cookies: [cookie] });
  expect(await manager.pollQr(qrKey)).toBe('waiting');
  expect(await manager.pollQr(qrKey)).toBe('waiting');
  expect(request).toHaveBeenCalledTimes(2);
  tick(2000);
  answer({ code: 0, data: { code: 86090 } }, { cookies: [cookie] });
  expect(await manager.pollQr(qrKey)).toBe('scanned');
  expect(secureStore.set).not.toHaveBeenCalled();
  tick(2000);
  answer(login, { cookies: [cookie, 'bili_jct=ignored; Domain=.bilibili.com; Path=/'] });
  expect(await manager.pollQr(qrKey)).toBe('signed_in');
  expect(await manager.getStatus()).toBe('signed_in');
  expect(JSON.parse(secureStore.set.mock.calls[0][0])).toEqual({
    value: 'mock%2Ctest',
    expiresAt: 1_800_000_064_000,
  });
  for (const [, init] of request.mock.calls)
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
  expect(JSON.stringify(request.mock.calls)).not.toContain('Cookie');
  expect(JSON.stringify(request.mock.calls)).not.toContain('example.invalid');
});

it('expires and locally revokes without sending logout or retaining a cookie', async () => {
  const { manager, request, secureStore, tick } = fixture();
  await secureStore.set(JSON.stringify({ value: 'sample', expiresAt: 1_800_000_001_000 }));
  expect(await manager.getStatus()).toBe('signed_in');
  tick(1001);
  expect(await manager.getStatus()).toBe('signed_out');
  await secureStore.set(JSON.stringify({ value: 'sample', expiresAt: 1_800_000_005_000 }));
  await manager.signOut();
  expect(await manager.getStatus()).toBe('signed_out');
  await expect(manager.readAuthorized(player, new AbortController().signal)).rejects.toMatchObject({
    code: 'session_unavailable',
  });
  expect(request).not.toHaveBeenCalled();
  expect(secureStore.remove).toHaveBeenCalledTimes(2);
});

it.each([
  'https://api.bilibili.com/x/player/v2?bvid=BV1xE41187RJ&cid=126758089',
  'https://api.bilibili.com/x/web-interface/view?bvid=BV1xE41187RJ',
  'https://api.bilibili.com/x/web-interface/popular?pn=1&ps=50',
  'https://api.bilibili.com/x/web-interface/ranking/v2?rid=188&type=all',
])('sends SESSDATA only on an exact Bilibili route (%s)', async (url) => {
  const { manager, answer, request, secureStore } = fixture();
  await secureStore.set(JSON.stringify({ value: 'sample', expiresAt: 1_800_000_001_000 }));
  answer({ code: 0 });
  expect((await manager.readAuthorized(new URL(url), new AbortController().signal)).ok).toBe(true);
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith(
    url,
    expect.objectContaining({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: 'application/json', Cookie: 'SESSDATA=sample' },
    }),
  );
});

it.each([
  'https://api.bilibili.com.evil.invalid/x/player/v2?bvid=BV1xE41187RJ&cid=126758089',
  'https://api.bilibili.com:1234/x/player/v2?bvid=BV1xE41187RJ&cid=126758089',
  'https://account.bilibili.com/x/player/v2?bvid=BV1xE41187RJ&cid=126758089',
  'https://api.bilibili.com/x/player/wbi/v2?bvid=BV1xE41187RJ&cid=126758089',
  'https://api.bilibili.com/x/player/v2?bvid=BV1xE41187RJ&cid=126758089&cid=1',
  'https://api.bilibili.com/x/player/v2?bvid=BV1xE41187RJ&cid=126758089&return=https://evil.invalid',
  'https://api.bilibili.com/x/web-interface/popular?pn=1&ps=100',
  'https://api.bilibili.com/x/web-interface/ranking/v2?rid=2&type=all',
])('rejects unapproved origin, route or query before loading a secret (%s)', async (url) => {
  const { manager, request, secureStore } = fixture();
  await expect(
    manager.readAuthorized(new URL(url), new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'invalid_response',
  });
  expect(secureStore.get).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it.each([
  scan.replace('account.bilibili.com', 'account.bilibili.com.evil.invalid'),
  scan.replace('callback=close', 'callback=https://evil.invalid'),
  scan.replace(qrKey, 'badkey'),
])('rejects unapproved official QR target (%s)', async (url) => {
  const { manager, answer, secureStore } = fixture();
  answer({ code: 0, data: { qrcode_key: qrKey, url } });
  await expect(manager.beginQr()).rejects.toMatchObject({ code: 'invalid_response' });
  expect(secureStore.set).not.toHaveBeenCalled();
});

it.each([
  { cookies: [] },
  { cookies: ['bili_jct=unexpected; Domain=.bilibili.com; Path=/'] },
  { cookies: [cookie, cookie] },
  { cookies: [cookie.replace('bilibili.com', 'example.invalid')] },
  { cookies: [cookie.replace('Max-Age=60', 'Max-Age=0')] },
  { cookies: [cookie.replace('mock%2Ctest', 'mock,test')] },
])('rejects missing, duplicated, malformed or expired session headers', async ({ cookies }) => {
  const { manager, answer, secureStore } = fixture();
  answer(generated);
  await manager.beginQr();
  answer(login, { cookies });
  await expect(manager.pollQr(qrKey)).rejects.toMatchObject({ code: 'invalid_response' });
  expect(secureStore.set).not.toHaveBeenCalled();
});

it.each([
  [{ code: -412, message: 'sensitive' }, 200],
  [{ code: 0, data: { code: -352 } }, 200],
  [{}, 429],
])('stops this QR on upstream restrictions', async (body, status) => {
  const { manager, answer, request, secureStore } = fixture();
  answer(generated);
  await manager.beginQr();
  answer(body, { status, cookies: [cookie] });
  await expect(manager.pollQr(qrKey)).rejects.toMatchObject({
    code: 'blocked',
    message: 'bilibili_session_blocked',
  });
  expect(await manager.pollQr(qrKey)).toBe('expired');
  expect(request).toHaveBeenCalledTimes(2);
  expect(secureStore.set).not.toHaveBeenCalled();
});

it('does not save the result of a locally cancelled QR or poll past its expiry', async () => {
  const { manager, answer, tick, request, secureStore } = fixture();
  answer(generated);
  await manager.beginQr();
  tick(180001);
  expect(await manager.pollQr(qrKey)).toBe('expired');
  expect(request).toHaveBeenCalledOnce();
  answer(generated);
  await manager.beginQr();
  const controller = new AbortController();
  const response = new Response(JSON.stringify(login), { headers: { 'Set-Cookie': cookie } });
  request.mockImplementationOnce(async (url) => {
    Object.defineProperty(response, 'url', { value: url });
    controller.abort();
    return response;
  });
  await expect(manager.pollQr(qrKey, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(secureStore.set).not.toHaveBeenCalled();
});

it('rejects an unexpected response origin and cancels an in-flight read after disconnect', async () => {
  const { manager, answer, request, secureStore } = fixture();
  await secureStore.set(JSON.stringify({ value: 'sample', expiresAt: 1_800_000_001_000 }));
  answer({}, { url: 'https://evil.invalid/', redirected: true });
  await expect(manager.readAuthorized(player, new AbortController().signal)).rejects.toMatchObject({
    code: 'invalid_response',
  });
  request.mockImplementationOnce(async (url) => {
    await manager.signOut();
    const response = new Response('{}');
    Object.defineProperty(response, 'url', { value: url });
    return response;
  });
  await expect(manager.readAuthorized(player, new AbortController().signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(await manager.getStatus()).toBe('signed_out');
});
