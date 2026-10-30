import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { ContentItem, ContentProvider } from '../exploration/content';
export interface WebDocument {
  url: string;
  title: string;
  text: string;
  source: string;
}
export interface AgentWeb {
  search(query: string, signal?: AbortSignal): Promise<WebDocument[]>;
  read(url: string, signal?: AbortSignal): Promise<WebDocument>;
  bilibili(query: string, signal?: AbortSignal): Promise<WebDocument[]>;
}
export function publicUrl(input: string): URL {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.includes(':') ||
    /^[\d.]+$/.test(host) ||
    !host.includes('.')
  )
    throw new Error('只能读取公开 HTTPS 网页');
  url.hash = '';
  return url;
}
export function plainText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d{1,6});/g, (_, code: string) => {
      const n = Number(code);
      return n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}
export class PublicAgentWeb implements AgentWeb {
  constructor(
    private content: ContentProvider,
    private request: typeof fetch = fetch,
  ) {}
  private async text(input: string, parent?: AbortSignal): Promise<{ url: string; text: string }> {
    const controller = new AbortController(),
      abort = () => controller.abort();
    parent?.addEventListener('abort', abort);
    if (parent?.aborted) abort();
    const timeout = setTimeout(abort, 15000);
    try {
      let url = publicUrl(input);
      for (let redirects = 0; redirects < 4; redirects++) {
        const response = await this.request(url.href, {
          signal: controller.signal,
          redirect: 'manual',
          credentials: 'omit',
          headers: { Accept: 'text/html,application/rss+xml,application/json,text/plain' },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const target = response.headers.get('location');
          if (!target) throw new Error('网页跳转无地址');
          url = publicUrl(new URL(target, url).href);
          continue;
        }
        if (!response.ok) throw new Error(`网页暂不可用（HTTP ${response.status}）`);
        // Reject an implementation that silently followed redirects despite manual mode.
        if (response.redirected || (response.url && publicUrl(response.url).href !== url.href))
          throw new Error('网页发生了未受控跳转');
        if (Number(response.headers.get('content-length')) > 524288)
          throw new Error('网页内容过大');
        let text = '';
        if (response.body?.getReader) {
          const reader = response.body.getReader(),
            decoder = new TextDecoder();
          let bytes = 0;
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > 524288) {
                await reader.cancel();
                throw new Error('网页内容过大');
              }
              text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
          } finally {
            reader.releaseLock();
          }
        } else text = await response.text();
        if (text.length > 524288) throw new Error('网页内容过大');
        return { url: url.href, text };
      }
      throw new Error('网页跳转次数过多');
    } finally {
      clearTimeout(timeout);
      parent?.removeEventListener('abort', abort);
    }
  }
  async pluginSource(url: string): Promise<string> {
    return (await this.text(url)).text;
  }
  async search(query: string, signal?: AbortSignal): Promise<WebDocument[]> {
    const response = await this.text(
      `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
      signal,
    );
    const parsed = new XMLParser({ ignoreAttributes: true, processEntities: false }).parse(
      response.text,
    ) as { rss?: { channel?: { item?: unknown } } };
    const raw = parsed.rss?.channel?.item;
    if (!raw) return [];
    return (Array.isArray(raw) ? raw : [raw]).slice(0, 6).flatMap((item) => {
      const result = z
        .object({ link: z.string(), title: z.string(), description: z.string().optional() })
        .safeParse(item);
      if (!result.success) return [];
      try {
        return [
          {
            url: publicUrl(result.data.link).href,
            title: plainText(result.data.title).slice(0, 300),
            text: plainText(result.data.description ?? '').slice(0, 1500),
            source: 'web-search-snippet',
          },
        ];
      } catch {
        return [];
      }
    });
  }
  async read(url: string, signal?: AbortSignal): Promise<WebDocument> {
    const response = await this.text(url, signal),
      title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(response.text)?.[1];
    return {
      url: response.url,
      title: plainText(title ?? new URL(url).hostname).slice(0, 300),
      text: plainText(response.text).slice(0, 10000),
      source: 'web-page',
    };
  }
  async bilibili(query: string, signal?: AbortSignal): Promise<WebDocument[]> {
    if (signal?.aborted) throw new Error('已取消');
    // Public guest recommendations. Selection is the agent's own, not a user-profile ranking.
    let items: ContentItem[];
    try {
      items = await this.content.candidates();
    } catch {
      throw new Error('B站游客接口暂不可用，没有读取到视频内容');
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const ranked = items
      .map((item) => ({
        item,
        hits: terms.filter((term) =>
          `${item.title} ${item.description} ${item.category}`.toLowerCase().includes(term),
        ).length,
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 8);
    return ranked.map(({ item }) => ({
      url: item.url,
      title: item.title,
      text: `仅标题与简介，未播放视频。UP主：${item.author}；分区：${item.category}。${item.description}`,
      source: this.content.id === 'bilibili' ? 'bilibili-metadata' : 'mock-bilibili-metadata',
    }));
  }
}
