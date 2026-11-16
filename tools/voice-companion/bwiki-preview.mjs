import { Buffer } from 'node:buffer';
/** Narrow, public BWIKI HSR/Genshin Chinese audition only. No cookies, redirects, guessing,
 * referer workarounds, crawling, model input, or reference-audio assignment. */
export const BWIKI_HTML_LIMIT = 1024 * 1024;
export const BWIKI_AUDIO_LIMIT = 2 * 1024 * 1024;
export class BwikiPreviewError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'BwikiPreviewError';
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new BwikiPreviewError(status, message);
};
const abortError = () => new DOMException('试听已取消', 'AbortError');
function strictUrl(input, host) {
  if (
    typeof input !== 'string' ||
    input.length > 1024 ||
    /[\s\\?#\u0000-\u001f\u007f]/u.test(input) ||
    /\/(?:\.|%2e){1,2}(?:\/|$)/i.test(input)
  )
    return null;
  try {
    const u = new URL(input);
    return u.protocol === 'https:' &&
      u.hostname === host &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search &&
      !u.hash
      ? u
      : null;
  } catch {
    return null;
  }
}
export function resolveBwikiVoicePage(input) {
  const u = strictUrl(input, 'wiki.biligame.com');
  let path;
  try {
    path = u && decodeURIComponent(u.pathname);
  } catch {
    path = null;
  }
  const sr = path && /^\/sr\/([\p{Script=Han}·•]{1,32})\/语音$/u.exec(path);
  const ys = path && /^\/ys\/([\p{Script=Han}·•]{1,32})语音$/u.exec(path);
  if (sr)
    return `https://wiki.biligame.com/sr/${encodeURIComponent(sr[1])}/${encodeURIComponent('语音')}`;
  if (ys) return `https://wiki.biligame.com/ys/${encodeURIComponent(ys[1] + '语音')}`;
  fail(400, '仅支持 BWIKI 星穹铁道 /sr/角色名/语音 或原神 /ys/角色名语音 页面');
}
function audioUrl(input, game) {
  const u = strictUrl(input, 'patchwiki.biligame.com');
  if (!u) return null;
  const m = /^\/images\/(sr|ys)\/([0-9a-f])\/([0-9a-f]{2})\/([a-z0-9]{20,64})\.mp3$/.exec(
    u.pathname,
  );
  return m && m[1] === game && m[3][0] === m[2] ? u.href : null;
}
function entities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp);/gi, (_, key) => {
    if (key[0] === '#') {
      const value =
        key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value)
        : '\ufffd';
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[key.toLowerCase()];
  });
}
function attribute(attrs, name) {
  const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'gi');
  const found = [...attrs.matchAll(re)];
  return found.length === 1 ? entities(found[0][1] ?? found[0][2]) : null;
}
function cells(row, tag) {
  const found = [
    ...row.matchAll(new RegExp('<' + tag + '\\b([^>]*)>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'gi')),
  ];
  if (found.some((m) => /\b(?:rowspan|colspan)\s*=/i.test(m[1]))) return [];
  return found.map((m) => m[2]);
}
/** Only explicit four-language table headers prove the Chinese column. */
export function selectBwikiChineseAudio(html, game = 'sr') {
  if (!['sr', 'ys'].includes(game)) fail(400, '不支持的游戏语音命名空间');
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > BWIKI_HTML_LIMIT)
    fail(413, '公开语音页面超过读取限制');
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  let tables = 0;
  for (const table of clean.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)) {
    if (++tables > 1000) fail(502, '公开语音页面结构异常');
    if (/<table\b/i.test(table[1])) continue;
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
    for (let i = 0; i < rows.length - 1; i++) {
      const labels = cells(rows[i][1], 'th').map((text) =>
        entities(text.replace(/<[^>]*>/g, '')).trim(),
      );
      if (
        labels.length !== 4 ||
        new Set(labels).size !== 4 ||
        !['中', '日', '英', '韩'].every((label) => labels.includes(label))
      )
        continue;
      const columns = cells(rows[i + 1][1], 'td');
      if (columns.length !== 4) continue;
      const chosen = columns[labels.indexOf('中')];
      const players = [...chosen.matchAll(/<div\b([^>]*)>/gi)].filter((m) =>
        attribute(m[1], 'class')?.split(/\s+/).includes('bikit-audio'),
      );
      if (players.length !== 1) continue;
      const source = attribute(players[0][1], 'data-src');
      if (source === null || source.trim() === '') continue;
      const resolved = audioUrl(source, game);
      if (!resolved) fail(502, '中文试听源地址格式变化，未猜测其他音频');
      return resolved;
    }
  }
  fail(404, '未找到可验证的非空中文试听列，未改用其他语种');
}
function interrupted(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const stop = () => reject(abortError());
    signal.addEventListener('abort', stop, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      },
    );
  });
}
async function readBounded(response, max, signal) {
  if (!response.body?.getReader) fail(502, '公开试听源返回空内容');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) {
    await response.body.cancel();
    fail(413, '公开试听内容超过大小限制');
  }
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0,
    done = false;
  try {
    while (true) {
      const part = await interrupted(reader.read(), signal);
      if (part.done) {
        done = true;
        break;
      }
      if (!(part.value instanceof Uint8Array) || part.value.length > max - size)
        fail(413, '公开试听内容超过大小限制');
      size += part.value.length;
      chunks.push(Buffer.from(part.value));
    }
    if (!size) fail(502, '公开试听源返回空内容');
    // Fetch transparently decompresses HTTP content; compare length only for identity encoding.
    const encoding = response.headers.get('content-encoding');
    if (
      declared !== null &&
      (!encoding || encoding.toLowerCase() === 'identity') &&
      Number(declared) !== size
    )
      fail(502, '公开试听传输不完整');
    return Buffer.concat(chunks, size);
  } finally {
    if (!done) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function frame(bytes, at) {
  if (at + 4 > bytes.length || bytes[at] !== 255 || (bytes[at + 1] & 224) !== 224) return null;
  const version = (bytes[at + 1] >> 3) & 3,
    layer = (bytes[at + 1] >> 1) & 3,
    index = bytes[at + 2] >> 4,
    rateIndex = (bytes[at + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || index === 0 || index === 15 || rateIndex === 3) return null;
  const rates = [44100, 48000, 32000],
    rate = rates[rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const kbps = (
    version === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  )[index];
  const length =
    Math.floor(((version === 3 ? 144000 : 72000) * kbps) / rate) + ((bytes[at + 2] >> 1) & 1);
  return at + length <= bytes.length ? { length, version, rate } : null;
}
function validateMp3(bytes) {
  let at = 0;
  if (bytes.toString('ascii', 0, 3) === 'ID3') {
    if (
      bytes.length < 10 ||
      ![2, 3, 4].includes(bytes[3]) ||
      bytes[4] === 255 ||
      [6, 7, 8, 9].some((i) => bytes[i] > 127)
    )
      fail(502, '试听不是有效 MP3');
    at =
      10 +
      bytes[6] * 2097152 +
      bytes[7] * 16384 +
      bytes[8] * 128 +
      bytes[9] +
      (bytes[3] === 4 && bytes[5] & 16 ? 10 : 0);
  }
  const first = frame(bytes, at),
    second = first && frame(bytes, at + first.length);
  if (!first || !second || first.version !== second.version || first.rate !== second.rate)
    fail(502, '试听不是有效或完整的 MP3');
}
// Some public .mp3 assets actually contain Ogg. Validate the container and codec,
// then report its real MIME; extension or upstream Content-Type is not proof.
function validateOgg(bytes) {
  let at = 0,
    sequence = 0,
    serial = null,
    firstPacket = null,
    pages = 0,
    ended = false;
  while (at < bytes.length) {
    if (
      ended ||
      at + 27 > bytes.length ||
      bytes.toString('ascii', at, at + 4) !== 'OggS' ||
      bytes[at + 4] !== 0
    )
      fail(502, '试听 Ogg 容器不完整');
    const flags = bytes[at + 5],
      segments = bytes[at + 26],
      headerEnd = at + 27 + segments;
    if (flags > 7 || headerEnd > bytes.length || !segments) fail(502, '试听 Ogg 页头无效');
    const currentSerial = bytes.readUInt32LE(at + 14),
      currentSequence = bytes.readUInt32LE(at + 18);
    if (pages === 0) {
      if (flags !== 2 || currentSequence !== 0) fail(502, '试听 Ogg 起始页无效');
      serial = currentSerial;
    }
    if (currentSerial !== serial || currentSequence !== sequence++) fail(502, '试听 Ogg 流不连续');
    let size = 0;
    for (let i = at + 27; i < headerEnd; i++) size += bytes[i];
    const end = headerEnd + size;
    if (end > bytes.length) fail(502, '试听 Ogg 数据截断');
    let crc = 0;
    for (let i = at; i < end; i++) {
      crc ^= (i >= at + 22 && i < at + 26 ? 0 : bytes[i]) << 24;
      for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
    if (crc >>> 0 !== bytes.readUInt32LE(at + 22)) fail(502, '试听 Ogg 校验失败');
    if (pages === 0) {
      let length = 0,
        complete = false;
      for (let i = at + 27; i < headerEnd; i++) {
        length += bytes[i];
        if (bytes[i] < 255) {
          complete = true;
          break;
        }
      }
      if (!complete) fail(502, '试听 Ogg 编码头不完整');
      firstPacket = bytes.subarray(headerEnd, headerEnd + length);
    }
    ended = !!(flags & 4);
    at = end;
    pages++;
  }
  if (pages < 2 || !ended || !firstPacket) fail(502, '试听 Ogg 流不完整');
  const p = firstPacket;
  const vorbis =
    p.length === 30 &&
    p[0] === 1 &&
    p.toString('ascii', 1, 7) === 'vorbis' &&
    p.readUInt32LE(7) === 0 &&
    p[11] >= 1 &&
    p[11] <= 8 &&
    p.readUInt32LE(12) >= 8000 &&
    p.readUInt32LE(12) <= 192000 &&
    (p[29] & 1) === 1;
  const opus =
    p.length >= 19 &&
    p.toString('ascii', 0, 8) === 'OpusHead' &&
    p[8] === 1 &&
    p[9] >= 1 &&
    p[9] <= 8;
  const speex =
    p.length >= 80 &&
    p.toString('ascii', 0, 8) === 'Speex   ' &&
    p.readUInt32LE(32) === 80 &&
    p.readUInt32LE(36) >= 8000 &&
    p.readUInt32LE(36) <= 48000 &&
    p.readUInt32LE(48) >= 1 &&
    p.readUInt32LE(48) <= 2;
  if (!vorbis && !opus && !speex) fail(502, '试听 Ogg 编码不受支持');
}
export async function fetchBwikiPreview(input, { transport = fetch, signal } = {}) {
  const sourceUrl = resolveBwikiVoicePage(input);
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timedOut = false;
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20000);
  const get = async (url, accept) => {
    const response = await interrupted(
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw abortError();
        return transport(url, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
          headers: { Accept: accept },
        });
      }),
      controller.signal,
    );
    if (!response.ok || response.redirected)
      fail(502, `公开试听源返回 ${response.status}；没有重试或绕过限制`);
    return response;
  };
  try {
    const page = await get(sourceUrl, 'text/html');
    if (!/^text\/html(?:\s*;|$)/i.test(page.headers.get('content-type') || ''))
      fail(502, '公开语音页面不是 HTML');
    const html = new TextDecoder('utf-8', { fatal: true }).decode(
      await readBounded(page, BWIKI_HTML_LIMIT, controller.signal),
    );
    const resolved = selectBwikiChineseAudio(html, new URL(sourceUrl).pathname.split('/')[1]);
    const audio = await get(resolved, 'audio/mpeg');
    if (!/^audio\/(?:mpeg|mp3|ogg)(?:\s*;|$)/i.test(audio.headers.get('content-type') || ''))
      fail(502, '公开试听源没有返回支持的音频');
    const bytes = await readBounded(audio, BWIKI_AUDIO_LIMIT, controller.signal);
    const ogg = bytes.toString('ascii', 0, 4) === 'OggS';
    if (ogg) validateOgg(bytes);
    else validateMp3(bytes);
    return { bytes, contentType: ogg ? 'audio/ogg' : 'audio/mpeg', sourceUrl, audioUrl: resolved };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) fail(504, '公开试听请求超时，未自动重试');
    if (error instanceof BwikiPreviewError) throw error;
    fail(502, '无法读取公开试听，未重试或绕过访问限制');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stop);
  }
}
