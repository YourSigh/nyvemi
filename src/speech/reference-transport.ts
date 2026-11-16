/** Explicit speech requests only. Provider credentials never reach the companion. */
export const MAX_REFERENCE_WAV = 10 * 1024 * 1024;
export interface CompanionEndpoint {
  baseUrl: string;
  token: string;
}
export interface ResolvedReference {
  label: string;
  sourceUrl: string;
  wav: Uint8Array;
  usage: 'preview' | 'reference';
}
export interface ReferenceTransport {
  checkCompanion(signal?: AbortSignal, requireConverter?: boolean): Promise<boolean>;
  synthesize(text: string, signal: AbortSignal): Promise<Uint8Array>;
  convert(source: Uint8Array, reference: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
  resolveReference(
    query: string,
    urls?: string[],
    signal?: AbortSignal,
  ): Promise<ResolvedReference>;
  search(query: string, signal: AbortSignal): Promise<string[]>;
}
export function assertReferenceWav(bytes: Uint8Array, maxSeconds = 45): void {
  const bad = () => {
    throw Error('音频必须为有效且时长受限的 PCM WAV');
  };
  if (bytes.length < 44 || bytes.length > MAX_REFERENCE_WAV) bad();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (i: number) => String.fromCharCode(...bytes.subarray(i, i + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || v.getUint32(4, true) + 8 !== bytes.length) bad();
  let rate = 0,
    align = 0,
    data = -1,
    fmt = false,
    at = 12;
  for (; at + 8 <= bytes.length; ) {
    const length = v.getUint32(at + 4, true),
      end = at + 8 + length;
    if (end > bytes.length) bad();
    if (tag(at) === 'fmt ') {
      if (fmt || length < 16 || v.getUint16(at + 8, true) !== 1) bad();
      const channels = v.getUint16(at + 10, true),
        bits = v.getUint16(at + 22, true);
      rate = v.getUint32(at + 12, true);
      align = v.getUint16(at + 20, true);
      if (
        channels < 1 ||
        channels > 2 ||
        bits !== 16 ||
        rate < 8000 ||
        rate > 96000 ||
        align !== channels * 2 ||
        v.getUint32(at + 16, true) !== rate * align
      )
        bad();
      fmt = true;
    }
    if (tag(at) === 'data') {
      if (data !== -1) bad();
      data = length;
    }
    at = end + (length % 2);
  }
  if (at !== bytes.length || !fmt || data <= 0 || data % align || data / align / rate > maxSeconds)
    bad();
}
function waveFromDeepSeekPcm(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2 || bytes.length > 30 * 48000 || bytes.length % 2)
    throw Error('DeepSeek PCM 音频长度无效');
  const wav = new Uint8Array(44 + bytes.length),
    view = new DataView(wav.buffer);
  for (const [offset, tag] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const)
    for (let i = 0; i < 4; i++) wav[offset + i] = tag.charCodeAt(i);
  view.setUint32(4, wav.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, bytes.length, true);
  wav.set(bytes, 44);
  return wav;
}
function base64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
function decode(value: unknown): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(MAX_REFERENCE_WAV / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw Error('音频数据无效');
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function https(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    return u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443') &&
      host.includes('.') &&
      !/^[0-9.]+$/.test(host) &&
      !host.includes(':') &&
      !/\.(localhost|local|internal|test|invalid)$/.test(host)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function createReferenceTransport(deps: {
  getDeepSeekKey(): string | undefined | Promise<string | undefined>;
  getCompanion(): CompanionEndpoint | undefined | Promise<CompanionEndpoint | undefined>;
  fetch?: typeof fetch;
  allowDevLoopback?: boolean;
}): ReferenceTransport {
  const abortable = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
    if (signal.aborted) return Promise.reject(Error('请求已取消'));
    return new Promise((resolve, reject) => {
      const stop = () => reject(Error('请求已取消'));
      signal.addEventListener('abort', stop, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', stop);
          if (signal.aborted) reject(Error('请求已取消'));
          else resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', stop);
          reject(error);
        },
      );
    });
  };
  const request = async (
    url: string,
    token: string,
    body: unknown,
    signal: AbortSignal,
    json = false,
    timeoutMs = 15000,
    responseLimit?: number,
    outputPcm = false,
  ) => {
    if (signal.aborted) throw Error('请求已取消');
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, timeoutMs);
    try {
      const response = await abortable(
        (deps.fetch ?? fetch)(url, {
          method: 'POST',
          redirect: 'error',
          credentials: 'omit',
          signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        controller.signal,
      );
      if (!response.ok || response.redirected) throw Error('语音服务暂不可用');
      const type = response.headers.get('content-type') ?? '';
      if (
        !(
          json
            ? /^application\/json\b/i
            : outputPcm
              ? /^(?:audio\/pcm|application\/octet-stream)\b/i
              : /^audio\/(?:wav|x-wav|wave)\b/i
        ).test(type)
      )
        throw Error('语音服务响应格式无效');
      const max = responseLimit ?? (json ? 15 * 1024 * 1024 : MAX_REFERENCE_WAV);
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max))
        throw Error('语音响应过大');
      let bytes: Uint8Array;
      if (response.body?.getReader) {
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = [];
        let count = 0;
        try {
          while (true) {
            const r = await abortable(reader.read(), controller.signal);
            if (r.done) break;
            count += r.value.length;
            if (count > max) throw Error('语音响应过大');
            chunks.push(r.value);
          }
        } finally {
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        bytes = new Uint8Array(count);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
      } else {
        // Native fetch buffers internally. Require the server's bound before materializing.
        if (declared === null) throw Error('语音服务需提供响应大小');
        bytes = new Uint8Array(await abortable(response.arrayBuffer(), controller.signal));
      }
      if (controller.signal.aborted || bytes.length > max) throw Error('语音请求已取消或超过限制');
      return json ? (JSON.parse(new TextDecoder().decode(bytes)) as unknown) : bytes;
    } catch {
      throw Error(signal.aborted ? '语音请求已取消' : '语音服务请求失败');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    }
  };
  const companion = async () => {
    const c = await deps.getCompanion();
    if (!c?.token || /[\r\n]/.test(c.token)) throw Error('尚未配置参考音色服务');
    const u = new URL(c.baseUrl);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== '/' ||
      !(
        u.protocol === 'https:' ||
        (deps.allowDevLoopback &&
          u.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
      )
    )
      throw Error('参考音色服务地址无效');
    return { ...c, baseUrl: u.origin };
  };
  const key = async () => {
    const k = await deps.getDeepSeekKey();
    if (!k?.trim() || /[\r\n]/.test(k)) throw Error('未配置官方语音服务');
    return k.trim();
  };
  const queryText = (q: string) => {
    if (!q.trim() || q.length > 500) throw Error('搜索内容长度无效');
    return q.trim();
  };
  return {
    async checkCompanion(signal = new AbortController().signal, requireConverter = false) {
      try {
        const c = await companion();
        const r = (await request(`${c.baseUrl}/health`, c.token, {}, signal, true, 2500, 8192)) as {
          ok?: boolean;
          ready?: boolean;
          converterReady?: boolean;
        };
        return requireConverter ? r?.converterReady === true : r?.ok === true || r?.ready === true;
      } catch {
        return false;
      }
    },
    async synthesize(text, signal) {
      if (!text.trim() || text.length > 2000) throw Error('朗读文本长度无效');
      const bytes = (await request(
        'https://api.deepseek.com/v1/tools/tts',
        await key(),
        { text, voice_id: 'stella', format: 'pcm', filter_markdown: true },
        signal,
        false,
        15000,
        30 * 48000,
        true,
      )) as Uint8Array;
      return waveFromDeepSeekPcm(bytes);
    },
    async convert(source, reference, signal) {
      assertReferenceWav(source, 120);
      assertReferenceWav(reference);
      const c = await companion();
      const bytes = (await request(
        `${c.baseUrl}/v1/convert`,
        c.token,
        { sourceWavBase64: base64(source), referenceWavBase64: base64(reference) },
        signal,
        false,
        30000,
      )) as Uint8Array;
      assertReferenceWav(bytes, 120);
      return bytes;
    },
    async resolveReference(query, urls = [], signal = new AbortController().signal) {
      query = queryText(query);
      if (urls.length > 6 || urls.some((u) => !https(u))) throw Error('参考音频来源地址无效');
      const c = await companion();
      const result = (await request(
        `${c.baseUrl}/v1/reference/resolve`,
        c.token,
        { query, urls },
        signal,
        true,
        45000,
      )) as Partial<ResolvedReference> & { wavBase64?: unknown };
      if (
        !result ||
        typeof result.label !== 'string' ||
        !result.label.trim() ||
        result.label.length > 120 ||
        !https(result.sourceUrl) ||
        !['preview', 'reference'].includes(result.usage ?? '')
      )
        throw Error('参考音频响应无效');
      const wav = decode(result.wavBase64);
      assertReferenceWav(wav);
      return { label: result.label, sourceUrl: result.sourceUrl!, wav, usage: result.usage! };
    },
    async search(query, signal) {
      const result = (await request(
        'https://api.deepseek.com/v1/tools/search',
        await key(),
        { query: queryText(query), count: 6, need_content: false },
        signal,
        true,
        18000,
        1024 * 1024,
      )) as { results?: { url?: unknown }[] };
      if (!Array.isArray(result?.results)) return [];
      return [
        ...new Set(result.results.map((r) => https(r?.url)).filter((u): u is string => !!u)),
      ].slice(0, 6);
    },
  };
}
