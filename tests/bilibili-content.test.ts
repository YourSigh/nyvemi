import { expect, it, vi } from 'vitest';
import { BilibiliContentProvider } from '../src/exploration/content';

const video = {
  bvid: 'BV1234567890',
  title: '机器人与 <em>机械臂</em>',
  desc: '客观简介',
  tname: '科技',
};
const feed = (list: unknown[]) => new Response(JSON.stringify({ code: 0, data: { list } }));

it('uses one public category selected from character topics, with guest credentials omitted', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(feed([video]));
  const candidates = await new BilibiliContentProvider(request).candidates({
    topics: ['机器人', '软件', '动漫'],
  });

  expect(candidates).toMatchObject([
    { id: video.bvid, title: '机器人与 机械臂', category: '科技' },
  ]);
  expect(request).toHaveBeenCalledExactlyOnceWith(
    'https://api.bilibili.com/x/web-interface/ranking/v2?rid=188&type=all',
    expect.objectContaining({ credentials: 'omit', redirect: 'manual' }),
  );
});

it('uses popular metadata for unknown topics or when the selected category is empty', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(feed([]))
    .mockResolvedValueOnce(feed([video]))
    .mockResolvedValueOnce(feed([video]));
  const provider = new BilibiliContentProvider(request);
  expect(await provider.candidates({ topics: ['原神'] })).toHaveLength(1);
  expect(await provider.candidates({ topics: ['蓝蓝的丝绸'] })).toHaveLength(1);
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    'https://api.bilibili.com/x/web-interface/ranking/v2?rid=4&type=all',
    'https://api.bilibili.com/x/web-interface/popular?pn=1&ps=50',
    'https://api.bilibili.com/x/web-interface/popular?pn=1&ps=50',
  ]);
});

it('falls back once when the category returns an explicit unavailable status', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('server unavailable', { status: 503 }))
    .mockResolvedValueOnce(feed([video]));

  await expect(
    new BilibiliContentProvider(request).candidates({ topics: ['科技'] }),
  ).resolves.toHaveLength(1);
  expect(request).toHaveBeenCalledTimes(2);
});

it.each([
  {
    status: 412,
    code: -412,
    expected: { reason: 'http', httpStatus: 412, message: 'bilibili_http' },
  },
  {
    status: 200,
    code: -352,
    expected: { reason: 'api', apiCode: -352, message: 'bilibili_api' },
  },
])(
  'stops at access restrictions and only exposes sanitized diagnostics',
  async ({ status, code, expected }) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ code, message: 'raw response' }), { status }),
      );

    await expect(
      new BilibiliContentProvider(request).candidates({ topics: ['动画'] }),
    ).rejects.toMatchObject({ name: 'BilibiliSourceError', ...expected });
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it('separates malformed, oversized and network-failed responses', async () => {
  const invalid = new BilibiliContentProvider(async () => new Response('<html/>'));
  const oversized = new BilibiliContentProvider(async () => new Response('中'.repeat(360000)));
  const network = new BilibiliContentProvider(async () => {
    throw new Error('raw network message');
  });

  await expect(invalid.candidates()).rejects.toMatchObject({ reason: 'invalid_response' });
  await expect(oversized.candidates()).rejects.toMatchObject({ reason: 'too_large' });
  await expect(network.candidates()).rejects.toMatchObject({
    reason: 'network',
    message: 'bilibili_network',
  });
});

it('uses the same abort signal and time limit for the entire guest fetch', async () => {
  vi.useFakeTimers();
  try {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(feed([])), 8000)),
      )
      .mockImplementationOnce(
        (_, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
    const provider = new BilibiliContentProvider(request);
    const settled = expect(provider.candidates({ topics: ['科技'] })).rejects.toMatchObject({
      reason: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(12000);
    await settled;
    expect(request.mock.calls[0][1]?.signal).toBe(request.mock.calls[1][1]?.signal);
  } finally {
    vi.useRealTimers();
  }
});

it('cancels an in-flight request without fallback', async () => {
  const abort = new AbortController();
  const request = vi.fn<typeof fetch>().mockImplementation(
    (_, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const candidates = new BilibiliContentProvider(request).candidates({
    topics: ['动画'],
    signal: abort.signal,
  });
  const settled = expect(candidates).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort();
  await settled;
  expect(request).toHaveBeenCalledTimes(1);
});
