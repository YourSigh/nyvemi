import { z } from 'zod';
export interface ContentItem {
  id: string;
  title: string;
  description: string;
  category: string;
  author: string;
  url: string;
}
export interface ContentProvider {
  readonly id: string;
  candidates(): Promise<ContentItem[]>;
}
const video = z.object({
  bvid: z.string().regex(/^BV[A-Za-z0-9]{10}$/),
  title: z.string().min(1).max(500),
  desc: z.string().max(20000).default(''),
  tname: z.string().max(100).default(''),
  owner: z.object({ name: z.string().max(100) }).optional(),
});
/** Guest public discovery metadata. No cookies, login, video playback or account mutation. */
export class BilibiliContentProvider implements ContentProvider {
  readonly id = 'bilibili';
  constructor(private request: typeof fetch = fetch) {}
  async candidates(): Promise<ContentItem[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await this.request(
        'https://api.bilibili.com/x/web-interface/popular?pn=1&ps=50',
        {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
          credentials: 'omit',
        },
      );
      if (!response.ok) throw new Error('bilibili_http');
      if (Number(response.headers.get('content-length')) > 1048576)
        throw new Error('bilibili_size');
      let text = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 1048576) {
              controller.abort();
              throw new Error('bilibili_size');
            }
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      } else text = await response.text();
      if (text.length > 1048576) throw new Error('bilibili_size');
      const body = z
        .object({ code: z.literal(0), data: z.object({ list: z.array(z.unknown()).max(100) }) })
        .parse(JSON.parse(text));
      return body.data.list.flatMap((raw) => {
        const result = video.safeParse(raw);
        if (!result.success) return [];
        const v = result.data;
        const clean = (s: string) =>
          s
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return [
          {
            id: v.bvid,
            title: clean(v.title),
            description: clean(v.desc).slice(0, 2000),
            category: clean(v.tname),
            author: clean(v.owner?.name ?? ''),
            url: `https://www.bilibili.com/video/${v.bvid}`,
          },
        ];
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
/** Explicit injected fixtures only; production never silently invents browsing results. */
export class MockContentProvider implements ContentProvider {
  readonly id = 'mock-bilibili';
  constructor(private items: ContentItem[]) {}
  async candidates(): Promise<ContentItem[]> {
    return this.items;
  }
}
