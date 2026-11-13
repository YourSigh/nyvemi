import { expect, it, vi } from 'vitest';
import { MockContentProvider } from '../src/exploration/content';
import { PublicAgentWeb, publicUrl } from '../src/agent/web';
it('passes Bilibili interests to the provider and returns no unrelated results for a query', async () => {
  const robot = {
    id: 'BV1234567890',
    url: 'https://www.bilibili.com/video/BV1234567890',
    title: '机器人平衡实验',
    author: '实验室',
    category: '科技',
    description: '介绍双足运动',
  };
  const candidates = vi.fn().mockResolvedValue([
    robot,
    {
      ...robot,
      id: 'BV0987654321',
      title: '在家做饭',
      category: '美食',
      description: '煮一道菜',
    },
  ]);
  const web = new PublicAgentWeb({ id: 'bilibili', candidates });
  expect(await web.bilibili('机器人')).toEqual([
    expect.objectContaining({ title: robot.title, source: 'bilibili-metadata' }),
  ]);
  expect(candidates).toHaveBeenCalledWith({ topics: ['机器人'], signal: undefined });
  expect(await web.bilibili('乒乓球')).toEqual([]);
  expect(await web.bilibili('')).toHaveLength(2);
});
it('reads real-shaped search RSS and pages with bounded public HTTPS redirects', async () => {
  const request = vi.fn(
    async (url) =>
      new Response(
        String(url).includes('bing.com')
          ? '<rss><channel><item><title>机器人</title><link>https://example.com/a</link><description>简介</description></item></channel></rss>'
          : '<title>文章</title><script>bad()</script><p>正文</p>',
      ),
  );
  const web = new PublicAgentWeb(new MockContentProvider([]), request);
  const hits = await web.search('机器人 实验');
  expect(request.mock.calls[0][0]).toBe(
    'https://www.bing.com/search?format=rss&q=%E6%9C%BA%E5%99%A8%E4%BA%BA+%E5%AE%9E%E9%AA%8C',
  );
  expect(hits[0].source).toBe('web-search-snippet');
  const doc = await web.read(hits[0].url);
  expect(doc.text).not.toContain('bad()');
  expect(doc.text).toContain('正文');
  expect(() => publicUrl('https://127.0.0.1/a')).toThrow();
  expect(() => publicUrl('file:///secret')).toThrow();
  const redirect = new PublicAgentWeb(
    new MockContentProvider([]),
    (async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://localhost/secret' },
      })) as typeof fetch,
  );
  await expect(redirect.read('https://example.com/a')).rejects.toThrow();
});
it('extracts actual image-search metadata and rejects invented/private/malformed locations', async () => {
  const { imageSearchDocuments } = await import('../src/agent/web');
  const data = JSON.stringify({
    purl: 'https://example.org/role',
    murl: 'https://cdn.example.org/full.png',
    t: '角色立绘',
  }).replaceAll('"', '&quot;');
  const privateData = JSON.stringify({
    purl: 'https://127.0.0.1/a',
    murl: 'https://cdn.example.org/a',
  }).replaceAll('"', '&quot;');
  const result = imageSearchDocuments(
    `<a class="iusc" m="${data}"></a><a m="${privateData}"></a><a m="not-json"></a>`,
  );
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    url: 'https://example.org/role',
    images: [{ url: 'https://cdn.example.org/full.png' }],
    source: 'web-image-search',
  });
});

it('uses the public Baidu search host for the same encyclopedia entry on a 403', async () => {
  const entry = 'https://baike.baidu.com/item/role/1234?tracking=1';
  const alternate = 'https://bkso.baidu.com/item/role/1234';
  const body = `<title>角色</title><p>她有银色的头发</p><!--${'x'.repeat(525_000)}-->`;
  const request = vi.fn(async (url) =>
    String(url) === entry
      ? new Response('', { status: 403 })
      : new Response(body, { headers: { 'content-length': String(body.length) } }),
  );
  const web = new PublicAgentWeb(new MockContentProvider([]), request);
  await expect(web.read(entry)).resolves.toMatchObject({
    url: alternate,
    text: '角色 她有银色的头发',
  });
  expect(request.mock.calls.map(([url]) => url)).toEqual([entry, alternate]);
  await expect(web.read('https://other.example.com/role')).rejects.toThrow('过大');
});

it('reads and labels only verified subtitles for canonical Bilibili video links', async () => {
  const read = vi.fn().mockResolvedValue({ status: 'available', cues: [{ text: '真实字幕' }] });
  const available = vi.fn().mockResolvedValue(true);
  const web = new PublicAgentWeb(new MockContentProvider([]), fetch, { read, available });
  await expect(
    web.bilibiliCaptions('https://www.bilibili.com.evil.org/video/BV1234567890'),
  ).rejects.toThrow();
  await expect(
    web.bilibiliCaptions('https://www.bilibili.com/video/BV1234567890/?from=track'),
  ).resolves.toMatchObject({
    url: 'https://www.bilibili.com/video/BV1234567890',
    source: 'bilibili-subtitle',
    text: '只读了字幕片段，没有播放视频。\n真实字幕',
  });
  expect(read).toHaveBeenCalledExactlyOnceWith('BV1234567890', undefined);
  available.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(
    web.bilibiliCaptions('https://www.bilibili.com/video/BV1234567890'),
  ).rejects.toThrow();
});
