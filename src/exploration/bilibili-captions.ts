import { z } from 'zod';

export interface BilibiliCaptionReader {
  read(bvid: string, signal?: AbortSignal): Promise<BilibiliCaptionResult>;
}

type UnavailableReason =
  | 'invalid_video'
  | 'unsupported_video'
  | 'no_tracks'
  | 'authorization_required'
  | 'unverified_track'
  | 'denied'
  | 'unavailable'
  | 'invalid_response'
  | 'too_large'
  | 'timeout'
  | 'aborted';

export type BilibiliCaptionResult =
  | {
      status: 'available';
      bvid: string;
      part: 1;
      language: string;
      machineGenerated: boolean;
      cues: { start: number; end: number; text: string }[];
    }
  | { status: 'unavailable'; reason: UnavailableReason };

type AuthorizedRead = (request: URL, signal: AbortSignal) => Promise<Response>;
const bvId = /^BV[A-Za-z0-9]{10}$/;
const positiveId = z.number().int().safe().positive();
const envelope = z.object({ code: z.number().int(), data: z.unknown() });
const track = z.object({
  id_str: z.string().regex(/^\d{1,24}$/),
  lan: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
  subtitle_url: z.string().max(2048).optional(),
  type: z.number().int().optional(),
});
const video = z.object({
  bvid: z.string().regex(bvId),
  aid: positiveId,
  cid: positiveId,
  pages: z.array(z.object({ cid: positiveId, page: z.number().int() })).max(1000),
  subtitle: z.object({ list: z.array(z.unknown()).max(50) }).optional(),
});
const player = z.object({
  bvid: z.string().regex(bvId),
  aid: positiveId,
  cid: positiveId,
  login_mid: z.number().int().safe().nonnegative(),
  need_login_subtitle: z.boolean().optional(),
  is_ugc_pay_preview: z.boolean().optional(),
  subtitle: z.object({ subtitles: z.array(z.unknown()).max(50) }),
});
const captions = z.object({ body: z.array(z.unknown()).max(6000) });
const cue = z.object({
  from: z.number().finite().min(0).max(86400),
  to: z.number().finite().min(0).max(86400),
  content: z.string().max(4000),
});

class ReadFailure extends Error {
  constructor(readonly reason: UnavailableReason) {
    super(reason);
  }
}

function trackUrl(value: string | undefined): URL | undefined {
  if (!value) return;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return;
    const allowedPath = ['i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com'].includes(url.hostname)
      ? /^\/bfs\/subtitle\/[A-Za-z0-9_.-]+\.json$/
      : url.hostname === 'aisubtitle.hdslb.com'
        ? /^\/bfs\/(?:ai_subtitle\/prod|subtitle)\/[A-Za-z0-9_.-]+$/
        : undefined;
    if (allowedPath?.test(url.pathname)) return url;
  } catch {
    // A malformed or non-Bilibili URL cannot be used as a caption source.
  }
}

function tracks(raw: unknown[]) {
  return raw.flatMap((value) => {
    const parsed = track.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

async function readJson(response: Response, url: URL, maxBytes: number): Promise<unknown> {
  if (response.redirected || (response.url && response.url !== url.href))
    throw new ReadFailure('denied');
  if (!response.ok) {
    if ([401, 403, 412, 429, 451].includes(response.status) || response.status < 400)
      throw new ReadFailure('denied');
    throw new ReadFailure('unavailable');
  }
  if (Number(response.headers.get('content-length')) > maxBytes) throw new ReadFailure('too_large');
  const decoder = new TextDecoder();
  const reader = response.body?.getReader?.();
  let text = '';
  if (reader) {
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maxBytes) {
          void reader.cancel().catch(() => undefined);
          throw new ReadFailure('too_large');
        }
        text += decoder.decode(next.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  } else {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) throw new ReadFailure('too_large');
    text = decoder.decode(bytes);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ReadFailure('invalid_response');
  }
}

function apiData(raw: unknown): unknown {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) throw new ReadFailure('invalid_response');
  if (parsed.data.code === -101) throw new ReadFailure('authorization_required');
  if (parsed.data.code !== 0) throw new ReadFailure('denied');
  return parsed.data.data;
}

function sample(raw: unknown[]) {
  const valid = raw.flatMap((item) => {
    const parsed = cue.safeParse(item);
    if (!parsed.success) return [];
    const { from, to, content } = parsed.data;
    const text = content.replace(/\s+/g, ' ').trim().slice(0, 150);
    return to > from && text ? [{ start: from, end: to, text }] : [];
  });
  const chronologically = valid.sort((a, b) => a.start - b.start);
  const unique = chronologically.filter(
    (item, i) => i === 0 || item.text !== chronologically[i - 1].text,
  );
  const count = Math.min(unique.length, 12);
  return Array.from({ length: count }, (_, i) => {
    const at = count === 1 ? 0 : Math.round((i / (count - 1)) * (unique.length - 1));
    return unique[at];
  });
}

/** At most one opted-in video's corroborated track. Caption URLs and auth never leave this class. */
export class BilibiliCaptionProvider implements BilibiliCaptionReader {
  constructor(
    private readAuthorized: AuthorizedRead,
    private publicFetch: typeof fetch = fetch,
  ) {}

  async read(bvid: string, signal?: AbortSignal): Promise<BilibiliCaptionResult> {
    if (!bvId.test(bvid)) return { status: 'unavailable', reason: 'invalid_video' };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 12000);
    const requireActive = () => {
      if (signal?.aborted) throw new ReadFailure('aborted');
      if (controller.signal.aborted) throw new ReadFailure('timeout');
    };
    const publicRead = async (url: URL) => {
      requireActive();
      return await this.publicFetch(url, {
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'manual',
        headers: { Accept: 'application/json' },
      });
    };
    try {
      const metadata = new URL(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
      const view = video.safeParse(
        apiData(await readJson(await publicRead(metadata), metadata, 524288)),
      );
      if (!view.success || view.data.bvid !== bvid) throw new ReadFailure('invalid_response');
      const { aid, cid, pages } = view.data;
      if (pages.length !== 1 || pages[0].page !== 1 || pages[0].cid !== cid)
        throw new ReadFailure('unsupported_video');

      const identified = tracks(view.data.subtitle?.list ?? []);
      if (!identified.length) throw new ReadFailure('no_tracks');
      const endpoint = new URL(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`);
      requireActive();
      const response = await this.readAuthorized(endpoint, controller.signal);
      const details = player.safeParse(apiData(await readJson(response, endpoint, 262144)));
      if (
        !details.success ||
        details.data.bvid !== bvid ||
        details.data.aid !== aid ||
        details.data.cid !== cid
      )
        throw new ReadFailure('unverified_track');
      if (details.data.is_ugc_pay_preview) throw new ReadFailure('denied');
      if (
        !details.data.login_mid ||
        (details.data.need_login_subtitle && !details.data.subtitle.subtitles.length)
      )
        throw new ReadFailure('authorization_required');

      // A valid player response can still contain a track belonging to a different video.
      const matched = tracks(details.data.subtitle.subtitles).flatMap((entry) => {
        const origin = identified.find(
          (item) => item.id_str === entry.id_str && item.lan === entry.lan,
        );
        const url = trackUrl(entry.subtitle_url);
        if (
          !origin ||
          !url ||
          (origin.subtitle_url && trackUrl(origin.subtitle_url)?.href !== url.href)
        )
          return [];
        return [
          {
            url,
            language: entry.lan,
            machineGenerated: /^ai-/i.test(entry.lan) || entry.type === 1,
          },
        ];
      });
      const selected =
        matched.find((item) => !item.machineGenerated && /^zh(?:-|$)/i.test(item.language)) ??
        matched.find((item) => /^ai-zh(?:-|$)/i.test(item.language)) ??
        matched[0];
      if (!selected) throw new ReadFailure('unverified_track');
      const { url, language, machineGenerated } = selected;
      const body = captions.safeParse(await readJson(await publicRead(url), url, 524288));
      if (!body.success) throw new ReadFailure('invalid_response');
      const cues = sample(body.data.body);
      if (!cues.length) throw new ReadFailure('no_tracks');
      requireActive();
      return { status: 'available', bvid, part: 1, language, machineGenerated, cues };
    } catch (error) {
      return {
        status: 'unavailable',
        reason: signal?.aborted
          ? 'aborted'
          : controller.signal.aborted
            ? 'timeout'
            : error instanceof ReadFailure
              ? error.reason
              : 'unavailable',
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}
