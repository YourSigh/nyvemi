import { expect, it } from 'vitest';
import { MockContentProvider } from '../src/exploration/content';
import { PublicAgentWeb, publicUrl } from '../src/agent/web';
it('reads real-shaped search RSS and pages with bounded public HTTPS redirects', async () => {
  const request = (async (url) =>
    new Response(
      String(url).includes('bing.com')
        ? '<rss><channel><item><title>机器人</title><link>https://example.com/a</link><description>简介</description></item></channel></rss>'
        : '<title>文章</title><script>bad()</script><p>正文</p>',
    )) as typeof fetch;
  const web = new PublicAgentWeb(new MockContentProvider([]), request);
  const hits = await web.search('机器人');
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
