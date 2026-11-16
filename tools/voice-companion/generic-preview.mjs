import { Buffer } from 'node:buffer';
/** Public audio preview only. No authenticated browsing, JS, redirects, or model calls. */
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';

export const GENERIC_AUDIO_LIMIT = 8 * 1024 * 1024;
export const GENERIC_HTML_LIMIT = 3 * 1024 * 1024;
export const GENERIC_TIMEOUT_MS = 15_000;
export class GenericPreviewError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GenericPreviewError';
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new GenericPreviewError(status, message);
};
const abortError = () => new DOMException('试听已取消', 'AbortError');
function urlOf(value, base) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    /[\s\\\u0000-\u001f\u007f]/u.test(value)
  )
    fail(400, '仅支持公开 HTTPS 音频链接或含音频的页面');
  let u;
  try {
    u = new URL(value, base);
  } catch {
    fail(400, '链接格式无效');
  }
  if (
    u.protocol !== 'https:' ||
    (u.port && u.port !== '443') ||
    u.username ||
    u.password ||
    u.hash ||
    !u.hostname ||
    u.hostname.endsWith('.') ||
    /[\u0000-\u0020\u007f]/u.test(decodeSafe(u.pathname + u.search))
  )
    fail(400, '仅支持无凭据的 HTTPS 443 链接');
  if (
    /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/.test(u.hostname.toLowerCase()) ||
    (!u.hostname.includes('.') && !u.hostname.includes(':'))
  )
    fail(403, '不支持非公开主机名');
  for (const key of u.searchParams.keys())
    if (
      /(?:token|secret|password|credential|signature|authorization|cookie|session|bearer|jwt|ticket|api.?key|access.?key|^key$|^sig$|^auth$)/i.test(
        key,
      )
    )
      fail(400, '不支持带授权凭据或签名的链接');
  return u;
}
function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail(400, '链接编码无效');
  }
}
function ipv4Value(ip) {
  return ip.split('.').reduce((v, p) => v * 256 + Number(p), 0);
}
function in4(n, base, bits) {
  const span = 2 ** (32 - bits);
  return Math.floor(n / span) === Math.floor(ipv4Value(base) / span);
}
function ipv6Value(ip) {
  if (ip.includes('.') || ip.includes('%')) return null;
  const halves = ip.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fields =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
      : left;
  return fields.reduce((value, field) => (value << 16n) + BigInt(`0x${field}`), 0n);
}
function in6(n, base, bits) {
  const shift = BigInt(128 - bits);
  return n >> shift === ipv6Value(base) >> shift;
}
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const n = ipv4Value(address);
    return ![
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['168.63.129.16', 32],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.31.196.0', 24],
      ['192.52.193.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['192.175.48.0', 24],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 3],
    ].some(([base, bits]) => in4(n, base, bits));
  }
  if (isIP(address) === 6) {
    const n = ipv6Value(address);
    // Allow only global unicast, excluding transition, documentation and special allocations.
    return (
      n !== null &&
      in6(n, '2000::', 3) &&
      ![
        ['2001::', 23],
        ['2001:db8::', 32],
        ['2002::', 16],
        ['3fff::', 20],
        ['2620:4f:8000::', 48],
      ].some(([base, bits]) => in6(n, base, bits))
    );
  }
  return false;
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || abortError());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
function publicHostname(host) {
  if (
    host.length > 253 ||
    isIP(host) ||
    !host.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|localdomain|lan|home|corp|test|example|invalid|onion|alt|arpa)$/.test(
      host,
    )
  )
    return false;
  return host
    .split('.')
    .every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}
/** Fixed trusted resolver only; never accepts a caller-supplied DoH endpoint. */
async function publicDns(host, { signal }) {
  if (!publicHostname(host)) fail(403, '不向公共 DNS 查询内部或保留主机名');
  const controller = new AbortController();
  const cancel = () => controller.abort(abortError());
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timer = setTimeout(cancel, 5000);
  try {
    const answers = await Promise.all(
      ['A', 'AAAA'].map(async (type) => {
        const response = await fetch(
          `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`,
          {
            method: 'GET',
            redirect: 'error',
            credentials: 'omit',
            signal: controller.signal,
            headers: { Accept: 'application/dns-json', 'Accept-Encoding': 'identity' },
          },
        );
        try {
          if (
            response.status !== 200 ||
            !/^application\/(?:dns-json|json)(?:;|$)/i.test(
              response.headers.get('content-type') || '',
            )
          )
            fail(502, '公共 DNS 响应无效');
          const encoding = response.headers.get('content-encoding');
          if (encoding && encoding.toLowerCase() !== 'identity')
            fail(502, '公共 DNS 响应压缩不受支持');
          const length = response.headers.get('content-length');
          if (length && (!/^\d+$/.test(length) || Number(length) > 16384))
            fail(502, '公共 DNS 响应过大');
          const reader = response.body?.getReader();
          if (!reader) fail(502, '公共 DNS 响应无效');
          let size = 0;
          const chunks = [];
          try {
            while (true) {
              const { done, value } = await abortable(reader.read(), controller.signal);
              if (done) break;
              size += value.byteLength;
              if (size > 16384) fail(502, '公共 DNS 响应过大');
              chunks.push(Buffer.from(value));
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
          let body;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            fail(502, '公共 DNS 响应无效');
          }
          if (
            !body ||
            body.Status !== 0 ||
            (body.Answer !== undefined && !Array.isArray(body.Answer)) ||
            (body.Answer?.length || 0) > 64
          )
            fail(502, '公共 DNS 未返回有效结果');
          return (body.Answer || [])
            .filter((item) => item && (item.type === 1 || item.type === 28))
            .map((item) => ({ address: item.data, family: item.type === 1 ? 4 : 6 }));
        } finally {
          await response.body?.cancel().catch(() => {});
        }
      }),
    );
    return answers.flat();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    controller.abort();
  }
}
async function resolvePublic(url, resolve, signal, dohResolve) {
  signal.throwIfAborted();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let answers = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await abortable(resolve(host, { all: true, verbatim: true }), signal);
  // Some desktop proxies use only 198.18/15 as synthetic DNS. Never connect there;
  // independently resolve the public hostname, then apply the same all-address checks.
  if (
    Array.isArray(answers) &&
    answers.length > 0 &&
    answers.length <= 64 &&
    publicHostname(host) &&
    answers.every(
      (a) =>
        a && a.family === 4 && isIP(a.address) === 4 && in4(ipv4Value(a.address), '198.18.0.0', 15),
    )
  ) {
    signal.throwIfAborted();
    answers = await abortable(dohResolve(host, { signal }), signal);
  }
  if (
    !Array.isArray(answers) ||
    !answers.length ||
    answers.length > 64 ||
    answers.some((a) => !a || !isPublicAddress(a.address) || Number(a.family) !== isIP(a.address))
  )
    fail(403, '链接指向非公开网络，已拒绝');
  return answers[0];
}
/** Injectable request contract: (URL, {address,family,headers,signal}) -> {statusCode,headers,body:AsyncIterable}. */
function pinnedRequest(url, { address, family, headers, signal }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers,
        signal,
        agent: false,
        maxHeaderSize: 16 * 1024,
        // URL hostname remains intact for Host, certificate verification and TLS SNI.
        lookup: (_host, options, cb) =>
          options?.all ? cb(null, [{ address, family }]) : cb(null, address, family),
        rejectUnauthorized: true,
      },
      (response) =>
        resolve({ statusCode: response.statusCode, headers: response.headers, body: response }),
    );
    req.once('error', reject);
    req.end();
  });
}
function header(headers, name) {
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name);
  if (!entry) return '';
  if (Array.isArray(entry[1])) fail(502, '远端响应头无效');
  return String(entry[1]);
}
async function fetchBytes(
  url,
  { resolve, request, signal, dohResolve, dnsCache },
  audioOnly = false,
  earlyHtml = true,
) {
  // A preview job pins one verified answer per host. No cache crosses jobs.
  let verified = dnsCache.get(url.hostname);
  if (!verified) {
    verified = await resolvePublic(url, resolve, signal, dohResolve);
    dnsCache.set(url.hostname, verified);
  }
  signal.throwIfAborted();
  const response = await abortable(
    request(url, {
      ...verified,
      signal,
      headers: {
        Accept: audioOnly
          ? 'audio/*,application/octet-stream;q=0.8'
          : 'audio/*,text/html;q=0.8,application/octet-stream;q=0.7',
        'Accept-Encoding': 'identity',
        'User-Agent': 'PublicAudioPreview/1.0',
      },
    }),
    signal,
  );
  try {
    if (response.statusCode >= 300 && response.statusCode < 400)
      fail(422, '不跟随跳转，请提供最终公开音频链接');
    if (response.statusCode !== 200) fail(422, '公开来源无法直接读取，请换一个链接');
    const encoding = header(response.headers, 'content-encoding').trim().toLowerCase();
    if (encoding && encoding !== 'identity') fail(422, '不支持压缩的来源响应');
    const type = header(response.headers, 'content-type').split(';')[0].trim().toLowerCase();
    const html = type === 'text/html' || type === 'application/xhtml+xml';
    if (audioOnly && html) fail(422, '页面中的链接不是直接音频文件');
    const cap = html ? GENERIC_HTML_LIMIT : GENERIC_AUDIO_LIMIT;
    const declared = header(response.headers, 'content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > cap)) fail(413, '来源文件过大');
    let size = 0,
      nextHtmlCheck = 16 * 1024;
    const chunks = [];
    const iterator = response.body[Symbol.asyncIterator]();
    while (true) {
      const { done, value } = await abortable(iterator.next(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) fail(502, '远端数据无效');
      size += value.byteLength;
      if (size > cap) fail(413, '来源文件过大');
      chunks.push(Buffer.from(value));
      // Only HTML may stop early: complete literal tags suffice; audio must remain
      // complete and magic-validated. Parsing discards incomplete excluded blocks.
      if (html && earlyHtml && size >= nextHtmlCheck) {
        const prefix = Buffer.concat(chunks, size);
        if (candidates(prefix.toString('utf8'), url).length) return { bytes: prefix, html };
        nextHtmlCheck = size + 16 * 1024;
      }
    }
    if (declared && Number(declared) !== size) fail(502, '来源文件未完整返回');
    return { bytes: Buffer.concat(chunks, size), html, contentType: type };
  } finally {
    response.body?.destroy?.();
  }
}
function entities(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, key) => {
    if (key[0] !== '#')
      return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[key.toLowerCase()];
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
      ? String.fromCodePoint(n)
      : '\u0000';
  });
}
function* tags(html) {
  for (let i = 0; i < html.length; i++) {
    if (html[i] !== '<' || !/[a-z/]/i.test(html[i + 1] || '')) continue;
    const start = i;
    let quote = '';
    for (i++; i < html.length && i - start <= 8192; i++) {
      const c = html[i];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '\"' || c === "'") quote = c;
      else if (c === '>') {
        yield html.slice(start, i + 1);
        break;
      }
    }
  }
}
function candidates(html, base) {
  // Do not interpret scripts, templates, embedded videos, comments or base-tag rewrites.
  html = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|template|noscript|video)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  const found = [];
  let audio = false;
  for (const tag of tags(html)) {
    const match = /^<(\/?[a-z][\w:-]*)/i.exec(tag);
    if (!match) continue;
    const name = match[1].toLowerCase();
    if (name === '/audio') {
      audio = false;
      continue;
    }
    if (!['audio', 'source', 'meta'].includes(name)) continue;
    const attrs = Object.create(null);
    let duplicate = false;
    const body = tag.slice(name.length + 1, -1);
    for (const m of body.matchAll(/([^\s=/'"<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      const key = m[1].toLowerCase();
      if (Object.hasOwn(attrs, key)) duplicate = true;
      attrs[key] = entities(m[2] ?? m[3] ?? m[4]);
    }
    if (name === 'audio') audio = true;
    if (duplicate) continue;
    const value =
      name === 'audio' || (name === 'source' && audio)
        ? attrs.src
        : name === 'meta' &&
            ['og:audio', 'og:audio:url', 'og:audio:secure_url', 'twitter:player:stream'].includes(
              (attrs.property || attrs.name || '').toLowerCase(),
            )
          ? attrs.content
          : null;
    if (!value) continue;
    try {
      const u = urlOf(value, base);
      if (!found.some((x) => x.href === u.href)) found.push(u);
    } catch {
      /* Ignore unsupported literal URL. */
    }
    if (found.length === 2) break;
  }
  return found;
}
function mp3Frame(bytes, offset) {
  if (offset + 4 > bytes.length || bytes[offset] !== 255 || (bytes[offset + 1] & 224) !== 224)
    return 0;
  const version = (bytes[offset + 1] >> 3) & 3,
    layer = (bytes[offset + 1] >> 1) & 3;
  const rate = (bytes[offset + 2] >> 2) & 3,
    index = bytes[offset + 2] >> 4;
  if (version === 1 || layer !== 1 || rate === 3 || index === 0 || index === 15) return 0;
  const bitrate =
    (version === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[index] * 1000;
  const hz = [44100, 48000, 32000][rate] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  return Math.floor(((version === 3 ? 144 : 72) * bitrate) / hz) + ((bytes[offset + 2] >> 1) & 1);
}
export function detectAudioType(bytes) {
  if (
    bytes.length >= 44 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WAVE'
  ) {
    if (bytes.readUInt32LE(4) !== bytes.length - 8) return null;
    let off = 12,
      fmt = false,
      data = false;
    while (off + 8 <= bytes.length) {
      const size = bytes.readUInt32LE(off + 4),
        tag = bytes.toString('ascii', off, off + 4);
      if (off + 8 + size > bytes.length) return null;
      if (tag === 'fmt ' && size >= 16) fmt = true;
      if (tag === 'data' && size > 0) data = true;
      off += 8 + size + (size % 2);
    }
    return fmt && data && off === bytes.length ? 'audio/wav' : null;
  }
  if (
    bytes.length >= 35 &&
    bytes.toString('ascii', 0, 4) === 'OggS' &&
    bytes[4] === 0 &&
    bytes[26] > 0
  ) {
    const start = 27 + bytes[26];
    if (
      start > bytes.length ||
      start + bytes.subarray(27, start).reduce((a, b) => a + b, 0) > bytes.length
    )
      return null;
    if (
      bytes.toString('ascii', start, start + 8) === 'OpusHead' ||
      (bytes[start] === 1 && bytes.toString('ascii', start + 1, start + 7) === 'vorbis')
    )
      return 'audio/ogg';
  }
  let offset = 0;
  if (bytes.length >= 10 && bytes.toString('ascii', 0, 3) === 'ID3') {
    if (bytes.subarray(6, 10).some((n) => n > 127)) return null;
    offset =
      10 +
      bytes[6] * 2097152 +
      bytes[7] * 16384 +
      bytes[8] * 128 +
      bytes[9] +
      (bytes[5] & 16 ? 10 : 0);
  }
  const length = mp3Frame(bytes, offset),
    next = length && mp3Frame(bytes, offset + length);
  return length && next && offset + length + next <= bytes.length ? 'audio/mpeg' : null;
}
export async function fetchGenericPreview(
  input,
  { signal, resolve = lookup, request = pinnedRequest, dohResolve = publicDns } = {},
) {
  const url = urlOf(input);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(abortError());
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => {
    timedOut = true;
    cancel();
  }, GENERIC_TIMEOUT_MS);
  const context = { resolve, request, dohResolve, signal: controller.signal, dnsCache: new Map() };
  try {
    const first = await fetchBytes(url, context);
    if (!first.html) {
      const contentType = detectAudioType(first.bytes);
      if (!contentType) fail(422, '来源不是支持的 WAV、Ogg 或 MP3 音频');
      return { bytes: first.bytes, contentType, sourceUrl: url.href, audioUrl: url.href };
    }
    const urls = candidates(first.bytes.toString('utf8'), url);
    if (!urls.length) fail(422, '页面没有可直接试听的公开音频，不执行脚本或提取视频');
    let last;
    for (const audioUrl of urls) {
      try {
        const result = await fetchBytes(audioUrl, context, true),
          contentType = detectAudioType(result.bytes);
        if (!contentType) fail(422, '页面中的来源不是支持的直接音频文件');
        return { bytes: result.bytes, contentType, sourceUrl: url.href, audioUrl: audioUrl.href };
      } catch (error) {
        if (controller.signal.aborted) throw error;
        last = error;
      }
    }
    throw last;
  } catch (error) {
    if (timedOut) fail(504, '公开音频读取超时');
    if (signal?.aborted || controller.signal.aborted) throw abortError();
    if (error instanceof GenericPreviewError) throw error;
    fail(502, '无法安全读取公开音频来源');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

/** Secure bounded primitive for the narrow BWIKI parser, never an HTTP endpoint. */
export async function fetchPublicResource(
  input,
  { signal, resolve = lookup, request = pinnedRequest, dohResolve = publicDns } = {},
) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(stop, GENERIC_TIMEOUT_MS);
  try {
    return await fetchBytes(
      urlOf(input),
      { resolve, request, dohResolve, signal: controller.signal, dnsCache: new Map() },
      false,
      false,
    );
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (controller.signal.aborted) fail(504, '公开来源读取超时');
    if (error instanceof GenericPreviewError) throw error;
    fail(502, '无法安全读取公开来源');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    controller.abort();
  }
}
