import { expect, it, vi } from 'vitest';
import { BilibiliCaptionProvider } from '../src/exploration/bilibili-captions';

const bvid = 'BV1xE41187RJ';
const aid = 74097562;
const cid = 126758089;
const id_str = '18035018522165250';
const subtitle_url = '//i0.hdslb.com/bfs/subtitle/caption.json?auth_key=fixture';
const lang = { id_str, lan: 'zh-CN' };
const json = (value: unknown) => new Response(JSON.stringify(value));
const metadata = (overrides: Record<string, unknown> = {}) =>
  json({
    code: 0,
    data: { bvid, aid, cid, pages: [{ cid, page: 1 }], subtitle: { list: [lang] }, ...overrides },
  });
const player = (overrides: Record<string, unknown> = {}) =>
  json({
    code: 0,
    data: {
      bvid,
      aid,
      cid,
      login_mid: 1,
      subtitle: { subtitles: [{ ...lang, subtitle_url }] },
      ...overrides,
    },
  });
const captions = () =>
  json({
    body: [
      { from: 5, to: 6, content: '第二句' },
      { from: 7, to: 6, content: '不合法' },
      { from: 2, to: 3, content: ' 第一句\n在这里 ' },
    ],
  });

it('reads one corroborated track without passing the user session to the subtitle CDN', async () => {
  const publicFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(captions());
  const authorized = vi.fn(async (_url: URL, _signal: AbortSignal) => player());

  await expect(new BilibiliCaptionProvider(authorized, publicFetch).read(bvid)).resolves.toEqual({
    status: 'available',
    bvid,
    part: 1,
    language: 'zh-CN',
    machineGenerated: false,
    cues: [
      { start: 2, end: 3, text: '第一句 在这里' },
      { start: 5, end: 6, text: '第二句' },
    ],
  });
  expect(authorized).toHaveBeenCalledExactlyOnceWith(
    new URL(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`),
    expect.anything(),
  );
  expect(
    publicFetch.mock.calls.map(([url, init]) => [
      String(url),
      init?.credentials,
      init?.redirect,
      init?.headers,
    ]),
  ).toEqual([
    [
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      'omit',
      'manual',
      { Accept: 'application/json' },
    ],
    [`https:${subtitle_url}`, 'omit', 'manual', { Accept: 'application/json' }],
  ]);
});

it.each([
  { cid: 765 },
  { aid: 121 },
  { subtitle: { subtitles: [{ ...lang, id_str: '999', subtitle_url }] } },
  { subtitle: { subtitles: [{ ...lang, lan: 'en', subtitle_url }] } },
  { subtitle: { subtitles: [{ ...lang, subtitle_url: 'https://evil.test/bfs/subtitle/a.json' }] } },
  {
    subtitle: { subtitles: [{ ...lang, subtitle_url: 'http://i0.hdslb.com/bfs/subtitle/a.json' }] },
  },
  { subtitle: { subtitles: [{ ...lang, subtitle_url: 'https://i0.hdslb.com/bfs/face/a.json' }] } },
])('does not read malformed or mismatched tracks (%j)', async (data) => {
  const publicFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(metadata());
  const authorized = vi.fn(async () => player(data));

  await expect(new BilibiliCaptionProvider(authorized, publicFetch).read(bvid)).resolves.toEqual({
    status: 'unavailable',
    reason: 'unverified_track',
  });
  expect(publicFetch).toHaveBeenCalledTimes(1);
});

it('requires agreement with the public track URL when the view supplies one', async () => {
  const publicFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
    metadata({
      subtitle: { list: [{ ...lang, subtitle_url: '//i0.hdslb.com/bfs/subtitle/other.json' }] },
    }),
  );
  const authorized = vi.fn(async () => player());

  await expect(new BilibiliCaptionProvider(authorized, publicFetch).read(bvid)).resolves.toEqual({
    status: 'unavailable',
    reason: 'unverified_track',
  });
  expect(publicFetch).toHaveBeenCalledTimes(1);
});

it('stops at account restrictions, without retries or content requests', async () => {
  const publicFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(metadata());
  const authorized = vi.fn(async () =>
    json({ code: -101, data: null, message: 'private message' }),
  );
  const provider = new BilibiliCaptionProvider(authorized, publicFetch);

  await expect(provider.read(bvid)).resolves.toEqual({
    status: 'unavailable',
    reason: 'authorization_required',
  });
  expect(authorized).toHaveBeenCalledTimes(1);
  expect(publicFetch).toHaveBeenCalledTimes(1);
});

it('does not request the caption body for a paid-only preview', async () => {
  const publicFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(metadata());
  const authorized = vi.fn(async () => player({ is_ugc_pay_preview: true }));
  await expect(new BilibiliCaptionProvider(authorized, publicFetch).read(bvid)).resolves.toEqual({
    status: 'unavailable',
    reason: 'denied',
  });
  expect(publicFetch).toHaveBeenCalledTimes(1);
});

it('does not request account or content data for multiple parts or no identified tracks', async () => {
  const publicFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      metadata({
        pages: [
          { cid, page: 1 },
          { cid: 22, page: 2 },
        ],
      }),
    )
    .mockResolvedValueOnce(metadata({ subtitle: undefined }));
  const authorized = vi.fn(async () => player());
  const provider = new BilibiliCaptionProvider(authorized, publicFetch);

  await expect(provider.read(bvid)).resolves.toMatchObject({ reason: 'unsupported_video' });
  await expect(provider.read(bvid)).resolves.toMatchObject({ reason: 'no_tracks' });
  expect(authorized).not.toHaveBeenCalled();
});

it('does not follow redirects or expose signed URLs and account diagnostics', async () => {
  const publicFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }),
    );
  const authorized = vi.fn(async () => player());

  await expect(new BilibiliCaptionProvider(authorized, publicFetch).read(bvid)).resolves.toEqual({
    status: 'unavailable',
    reason: 'denied',
  });
  expect(publicFetch).toHaveBeenCalledTimes(2);
});

it('bounds UTF-8 caption bytes and returned evidence cues', async () => {
  const publicFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(new Response('中'.repeat(174764)))
    .mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(
      json({
        body: Array.from({ length: 120 }, (_, i) => ({
          from: i,
          to: i + 1,
          content: `${i}-${'x'.repeat(300)}`,
        })),
      }),
    );
  const authorized = vi.fn(async () => player());
  const provider = new BilibiliCaptionProvider(authorized, publicFetch);

  await expect(provider.read(bvid)).resolves.toMatchObject({ reason: 'too_large' });
  const result = await provider.read(bvid);
  expect(result.status).toBe('available');
  if (result.status === 'available') {
    expect(result.cues).toHaveLength(12);
    expect(result.cues.every((cue) => cue.text.length <= 150)).toBe(true);
    expect(result.cues[11].end).toBe(120);
  }
});

it('stops a read when the supplied session consent signal is aborted', async () => {
  const abort = new AbortController();
  const publicFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(metadata());
  const authorized = vi.fn(async () => {
    abort.abort();
    return player();
  });
  await expect(
    new BilibiliCaptionProvider(authorized, publicFetch).read(bvid, abort.signal),
  ).resolves.toEqual({ status: 'unavailable', reason: 'aborted' });
  expect(publicFetch).toHaveBeenCalledTimes(1);
});

it('labels a matched AI-generated track separately from human CC', async () => {
  const language = { ...lang, lan: 'ai-zh' };
  const publicFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(metadata({ subtitle: { list: [language] } }))
    .mockResolvedValueOnce(captions());
  const authorized = vi.fn(async () =>
    player({
      subtitle: {
        subtitles: [
          {
            ...language,
            subtitle_url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/abc?auth_key=fixture',
          },
        ],
      },
    }),
  );
  await expect(
    new BilibiliCaptionProvider(authorized, publicFetch).read(bvid),
  ).resolves.toMatchObject({
    status: 'available',
    machineGenerated: true,
    language: 'ai-zh',
  });
});

it('shares a twelve-second budget across metadata and the authorized request', async () => {
  vi.useFakeTimers();
  try {
    const publicFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(metadata()), 8000)),
      );
    const authorized = vi.fn(
      (_url: URL, signal: AbortSignal): Promise<Response> =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('request cancelled')));
        }),
    );
    const result = new BilibiliCaptionProvider(authorized, publicFetch).read(bvid);
    await vi.advanceTimersByTimeAsync(12000);
    await expect(result).resolves.toEqual({ status: 'unavailable', reason: 'timeout' });
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(publicFetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
