import { XMLParser } from 'fast-xml-parser';
import { id, type Experience } from '../domain/models';
import type { Storage } from '../storage/store';
import { localDayKey } from '../proactive/policies';
import { keywords } from '../memory/retrieval';
export interface ExperienceSource {
  id: string;
  fetch(): Promise<Experience[]>;
}
export class LocalTimeExperienceSource implements ExperienceSource {
  id = 'local-time';
  constructor(
    private characterId: string,
    private now = Date.now(),
  ) {}
  async fetch(): Promise<Experience[]> {
    const d = new Date(this.now);
    const h = d.getHours();
    const phase = h < 6 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    const events = [phase];
    if (d.getDay() === 0 || d.getDay() === 6) events.push('weekend');
    return events.map((event) => ({
      id: id(),
      characterId: this.characterId,
      source: this.id,
      externalId: `${localDayKey(this.now)}:${event}`,
      title: event,
      content: `本地环境：${event}`,
      topics: [event],
      createdAt: this.now,
    }));
  }
}
export class ConversationExperienceSource implements ExperienceSource {
  id = 'conversation';
  constructor(
    private store: Storage,
    private characterId: string,
    private now = Date.now(),
  ) {}
  async fetch(): Promise<Experience[]> {
    return (await this.store.list('memories', this.characterId, 100))
      .filter(
        (m) =>
          m.type === 'episodic' &&
          m.importance >= 0.6 &&
          (m.expiresAt === undefined || m.expiresAt > this.now),
      )
      .slice(0, 10)
      .map((m) => ({
        id: id(),
        characterId: this.characterId,
        source: this.id,
        externalId: m.id,
        title: '你们聊过的一件事',
        content: m.content,
        topics: [...keywords(m.content)].slice(0, 15),
        createdAt: this.now,
      }));
  }
}
const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : value && typeof value === 'object' && '#text' in value
        ? text(value['#text'])
        : '';
const clean = (value: unknown): string =>
  text(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
export function parseRss(
  xml: string,
  characterId: string,
  source: string,
  now: number,
): Experience[] {
  if (xml.length > 1024 * 1024 || /<!ENTITY|<!DOCTYPE/i.test(xml))
    throw new Error('Feed 过大或包含不支持的实体定义');
  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    trimValues: true,
  }).parse(xml);
  const root = parsed as { rss?: { channel?: { item?: unknown } }; feed?: { entry?: unknown } };
  const raw = root.rss?.channel?.item ?? root.feed?.entry ?? [];
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries.slice(0, 15).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const title = clean(item.title);
    if (!title) return [];
    let link = text(item.link);
    if (item.link && typeof item.link === 'object') {
      const links = Array.isArray(item.link) ? item.link : [item.link];
      const alternate = links.find(
        (l) => l && typeof l === 'object' && (!('@_rel' in l) || l['@_rel'] === 'alternate'),
      );
      if (alternate && typeof alternate === 'object' && '@_href' in alternate)
        link = text(alternate['@_href']);
    }
    let url: string | undefined;
    try {
      const u = new URL(link);
      if (u.protocol === 'https:' || u.protocol === 'http:') url = u.toString();
    } catch {}
    const content = clean(item.description ?? item.summary ?? item.content ?? '');
    const externalId = text(item.guid ?? item.id) || url || title;
    const published = Date.parse(text(item.pubDate ?? item.published ?? item.updated));
    if (Number.isFinite(published) && now - published > 7 * 86400000) return [];
    return [
      {
        id: id(),
        characterId,
        source,
        externalId,
        title,
        content,
        url,
        topics: [...keywords(`${title} ${content}`)].slice(0, 24),
        createdAt: now,
      },
    ];
  });
}
export class RSSExperienceSource implements ExperienceSource {
  id: string;
  constructor(
    private characterId: string,
    private url: string,
    private now = Date.now(),
    private request: typeof fetch = fetch,
  ) {
    this.id = `rss:${url}`;
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password)
      throw new Error('RSS 请使用不含凭据的 HTTPS 地址');
  }
  async fetch(): Promise<Experience[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await this.request(this.url, {
        signal: controller.signal,
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      });
      if (!response.ok) throw new Error('RSS 请求失败');
      if (Number(response.headers.get('content-length') ?? 0) > 1024 * 1024)
        throw new Error('RSS 过大');
      let xml = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            if (size > 1024 * 1024) {
              controller.abort();
              throw new Error('RSS 过大');
            }
            xml += decoder.decode(chunk.value, { stream: true });
          }
          xml += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      } else xml = await response.text();
      return parseRss(xml, this.characterId, this.id, this.now);
    } finally {
      clearTimeout(timeout);
    }
  }
}
