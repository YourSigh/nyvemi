import { z } from 'zod';
export interface ContentItem {
  id: string;
  title: string;
  description: string;
  category: string;
  author: string;
  url: string;
  discovery?: 'deepseek_search';
}
export interface ContentProvider {
  readonly id: string;
  candidates(query?: ContentQuery): Promise<ContentItem[]>;
}
export interface ContentQuery {
  topics?: readonly string[];
  signal?: AbortSignal;
  indexedSearch?: boolean;
}
type SourceFailure = 'http' | 'api' | 'invalid_response' | 'too_large' | 'timeout' | 'network';
export class BilibiliSourceError extends Error {
  constructor(
    readonly reason: SourceFailure,
    readonly httpStatus?: number,
    readonly apiCode?: number,
  ) {
    super(`bilibili_${reason}`);
    this.name = 'BilibiliSourceError';
  }
}
const video = z.object({
  bvid: z.string().regex(/^BV[A-Za-z0-9]{10}$/),
  title: z.string().min(1).max(500),
  desc: z.string().max(20000).default(''),
  tname: z.string().max(100).default(''),
  owner: z.object({ name: z.string().max(100) }).optional(),
});
const envelope = z.object({ code: z.number().int().min(-99999).max(99999) });
const feedData = z.object({ data: z.object({ list: z.array(z.unknown()).max(100) }) });
const maxBytes = 1024 * 1024;
const popularUrl = 'https://api.bilibili.com/x/web-interface/popular?pn=1&ps=50';
const categories = [
  [
    188,
    /科技|数码|机器人|机械|编程|代码|人工智能|电脑|计算机|硬件|软件|机器学习|\b(?:tech|coding|robotics?|programming|ai|computer|software|hardware)\b/i,
  ],
  [
    36,
    /知识|科普|历史|天文|地理|物理|化学|生物|考古|数学|科学|\b(?:science|history|astronomy|physics|chemistry|biology|math|knowledge)\b/i,
  ],
  [
    1,
    /动画|动漫|番剧|手书|二次元|漫画|绘画|插画|\b(?:anime|animation|manga|illustration|drawing)\b/i,
  ],
  [
    4,
    /游戏|电竞|原神|星穹铁道|崩铁|明日方舟|鸣潮|主机|手游|\b(?:games?|gaming|esports|genshin|steam)\b/i,
  ],
] as const;
function categoryUrl(topics: readonly string[]): string | undefined {
  const terms = [
    ...new Set(topics.slice(0, 16).map((topic) => topic.trim().toLowerCase().slice(0, 120))),
  ];
  const [match] = categories
    .map(([rid, pattern]) => ({
      rid,
      matches: terms.filter((topic) => pattern.test(topic)).length,
    }))
    .filter((category) => category.matches > 0)
    .sort((a, b) => b.matches - a.matches);
  return match
    ? `https://api.bilibili.com/x/web-interface/ranking/v2?rid=${match.rid}&type=all`
    : undefined;
}

function canUsePopular(error: BilibiliSourceError): boolean {
  return (
    error.reason === 'network' ||
    (error.reason === 'http' && [404, 410, 500, 502, 503, 504].includes(error.httpStatus ?? 0)) ||
    (error.reason === 'api' && error.apiCode === -404)
  );
}

function clean(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Guest public discovery metadata. No cookies, login, video playback or account mutation. */
export class BilibiliContentProvider implements ContentProvider {
  readonly id = 'bilibili';
  constructor(
    private request: typeof fetch = fetch,
    private session?: {
      getStatus(): Promise<'signed_in' | 'signed_out'>;
      readAuthorized(url: URL, signal: AbortSignal): Promise<Response>;
    },
    private search?: {
      candidates(topic: string, signal: AbortSignal): Promise<ContentItem[] | undefined>;
    },
  ) {}
  async candidates({ topics = [], signal, indexedSearch }: ContentQuery = {}): Promise<
    ContentItem[]
  > {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 12000);
    try {
      const topic = topics.find((value) => /[\p{L}\p{N}]/u.test(value));
      if (indexedSearch && topic && this.search && !controller.signal.aborted) {
        const indexed = await this.search.candidates(topic, controller.signal);
        if (controller.signal.aborted) throw new BilibiliSourceError('timeout');
        if (indexed) return indexed;
      }
      const ranked = categoryUrl(topics);
      if (ranked && !controller.signal.aborted) {
        try {
          const items = await this.fetchFeed(ranked, controller.signal);
          if (items.length && !controller.signal.aborted) return items;
        } catch (error) {
          if (
            controller.signal.aborted ||
            !(error instanceof BilibiliSourceError) ||
            !canUsePopular(error)
          )
            throw error;
        }
      }
      if (controller.signal.aborted) throw new BilibiliSourceError('timeout');
      const items = await this.fetchFeed(popularUrl, controller.signal);
      if (controller.signal.aborted) throw new BilibiliSourceError('timeout');
      return items;
    } catch (error) {
      if (signal?.aborted) {
        const cancelled = new Error('bilibili_aborted');
        cancelled.name = 'AbortError';
        throw cancelled;
      }
      if (controller.signal.aborted) throw new BilibiliSourceError('timeout');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  private async fetchFeed(url: string, signal: AbortSignal): Promise<ContentItem[]> {
    let text: string;
    try {
      const response =
        this.session && (await this.session.getStatus()) === 'signed_in'
          ? await this.session.readAuthorized(new URL(url), signal)
          : await this.request(url, {
              signal,
              headers: { Accept: 'application/json' },
              credentials: 'omit',
              redirect: 'manual',
            });
      if (!response.ok) throw new BilibiliSourceError('http', response.status);
      if (response.redirected || (response.url && response.url !== url))
        throw new BilibiliSourceError('invalid_response');
      if (Number(response.headers.get('content-length')) > maxBytes)
        throw new BilibiliSourceError('too_large');
      text = await this.readText(response);
    } catch (error) {
      if (error instanceof BilibiliSourceError) throw error;
      throw new BilibiliSourceError('network');
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BilibiliSourceError('invalid_response');
    }
    const status = envelope.safeParse(json);
    if (!status.success) throw new BilibiliSourceError('invalid_response');
    if (status.data.code !== 0) throw new BilibiliSourceError('api', undefined, status.data.code);
    const body = feedData.safeParse(json);
    if (!body.success) throw new BilibiliSourceError('invalid_response');
    return body.data.data.list.flatMap((raw) => {
      const result = video.safeParse(raw);
      if (!result.success) return [];
      const v = result.data;
      const title = clean(v.title);
      if (!title) return [];
      return [
        {
          id: v.bvid,
          title,
          description: clean(v.desc).slice(0, 2000),
          category: clean(v.tname),
          author: clean(v.owner?.name ?? ''),
          url: `https://www.bilibili.com/video/${v.bvid}`,
        },
      ];
    });
  }

  private async readText(response: Response): Promise<string> {
    if (!response.body?.getReader) {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > maxBytes) throw new BilibiliSourceError('too_large');
      return new TextDecoder().decode(bytes);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return text + decoder.decode();
        size += chunk.value.byteLength;
        if (size > maxBytes) {
          void reader.cancel().catch(() => undefined);
          throw new BilibiliSourceError('too_large');
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
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
