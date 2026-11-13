import { z } from 'zod';
import type { ProviderConfig } from '../domain/models';
import type { ApiMetric } from '../providers/provider';
import { id } from '../domain/models';
import { plainText } from '../agent/web';
import { BilibiliSourceError, type ContentItem } from './content';

const endpoint = 'https://api.deepseek.com/v1/tools/search';
const maxResponseBytes = 256 * 1024;
const page = z.object({
  url: z.string().max(2048),
  title: z.string().max(500),
  snippet: z.string().max(2000),
});
const envelope = z.object({ results: z.array(z.unknown()).max(50) });

export function supportsDeepSeekSearch(config: ProviderConfig | undefined): boolean {
  if (!config) return false;
  return /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(config.baseUrl);
}

function parseVideos(results: unknown[]): ContentItem[] {
  const videos = new Map<string, ContentItem>();
  for (const item of results) {
    const entry = page.safeParse(item);
    if (!entry.success) continue;
    const { url, title, snippet } = entry.data;
    const bvid = /^https:\/\/www\.bilibili\.com\/video\/(BV[A-Za-z0-9]{10})\/?(?:[?#].*)?$/.exec(
      url,
    )?.[1];
    if (!bvid || videos.has(bvid)) continue;
    const name = plainText(title)
      .replace(/_哔哩哔哩_bilibili.*$/i, '')
      .trim();
    if (!name) continue;
    videos.set(bvid, {
      id: bvid,
      title: name,
      description: plainText(snippet),
      author: '',
      category: '',
      url: `https://www.bilibili.com/video/${bvid}`,
      discovery: 'deepseek_search',
    });
  }
  return [...videos.values()];
}

/** Sends a character interest and a fixed site filter to DeepSeek. It never sends a Bilibili session. */
export class DeepSeekBilibiliSearch {
  constructor(
    private credentials: () => Promise<{ config: ProviderConfig | undefined; key: string | null }>,
    private request: typeof fetch = fetch,
    private metric: (entry: ApiMetric, billed: boolean) => Promise<void> = async () => {},
  ) {}

  async candidates(topic: string, signal: AbortSignal): Promise<ContentItem[] | undefined> {
    const words = Array.from(topic.matchAll(/[\p{L}\p{N}]+/gu), (m) => m[0]).join(' ');
    const term = [...words].slice(0, 80).join('');
    if (!term) return;
    const { config, key } = await this.credentials();
    if (!key || !supportsDeepSeekSearch(config)) return;
    if (signal.aborted) throw new BilibiliSourceError('timeout');
    const startedAt = Date.now();
    const requestId = id();
    let billed = false;
    let success = false;
    let status: number | undefined;
    try {
      const response = await this.request(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `${term} site:www.bilibili.com`,
          count: 16,
          need_content: false,
        }),
        signal,
        credentials: 'omit',
        redirect: 'error',
      });
      status = response.status;
      if (!response.ok) throw new BilibiliSourceError('http', status);
      if (response.redirected || (response.url && response.url !== endpoint))
        throw new BilibiliSourceError('invalid_response');
      const text = await readDiscoveryText(response, maxResponseBytes);
      const body = envelope.safeParse(JSON.parse(text));
      if (!body.success) throw new BilibiliSourceError('invalid_response');
      billed = body.data.results.length > 0;
      success = true;
      return parseVideos(body.data.results);
    } catch (error) {
      if (error instanceof BilibiliSourceError) throw error;
      throw new BilibiliSourceError(error instanceof SyntaxError ? 'invalid_response' : 'network');
    } finally {
      await this.metric(
        {
          requestId,
          startedAt,
          endpoint,
          model: 'DeepSeek 搜索',
          purpose: 'bilibili_discovery',
          duration: Date.now() - startedAt,
          success,
          error: success ? undefined : status && status >= 400 ? `HTTP ${status}` : 'search_failed',
        },
        billed,
      ).catch(() => undefined);
    }
  }
}

async function readDiscoveryText(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit)
    throw new BilibiliSourceError('too_large');
  const reader = response.body?.getReader?.();
  const decoder = new TextDecoder();
  if (!reader) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > limit) throw new BilibiliSourceError('too_large');
    return decoder.decode(bytes);
  }
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        void reader.cancel().catch(() => undefined);
        throw new BilibiliSourceError('too_large');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
