import { Buffer } from 'node:buffer';
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CompanionError, decodeWav, convertAudio } from './audio.mjs';
import { resolveReference } from './reference.mjs';
export const HOST = '127.0.0.1',
  PORT = 4319;
const BODY_CAP = 9 * 1024 * 1024;
const hash = (value) => createHash('sha256').update(value).digest();
function send(res, status, value) {
  if (res.destroyed) return;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': Buffer.isBuffer(value) ? 'audio/wav' : 'application/json; charset=utf-8',
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(bytes);
}
export function authorized(req, tokenHash) {
  const counts = {};
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const key = req.rawHeaders[i].toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  if (counts.origin || counts.host !== 1 || req.headers.host !== '127.0.0.1:4319')
    throw new CompanionError(403, '仅限本机应用连接');
  if (
    counts.authorization !== 1 ||
    typeof req.headers.authorization !== 'string' ||
    !req.headers.authorization.startsWith('Bearer ') ||
    req.headers.authorization.length > 520 ||
    !timingSafeEqual(hash(req.headers.authorization.slice(7)), tokenHash)
  )
    throw new CompanionError(401, '伴随服务口令无效');
}
async function jsonBody(req, signal) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '') ||
    (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
  )
    throw new CompanionError(415, '仅支持未压缩 JSON');
  const declared = req.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BODY_CAP))
    throw new CompanionError(413, '请求过大');
  const timer = setTimeout(() => req.destroy(), 10000);
  let size = 0;
  const chunks = [];
  const abort = () => req.destroy();
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of req) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > BODY_CAP) throw new CompanionError(413, '请求过大');
      chunks.push(chunk);
    }
    if (declared && Number(declared) !== size) throw new CompanionError(400, '请求不完整');
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new CompanionError(400, 'JSON 无效');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new CompanionError(400, 'JSON 对象无效');
    return body;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
export async function probeConverter({ signal, transport = fetch } = {}) {
  const controller = new AbortController(),
    stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(stop, 1000);
  try {
    controller.signal.throwIfAborted();
    const response = await transport('http://127.0.0.1:8000/health', {
      method: 'GET',
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
    });
    try {
      if (
        response.status !== 200 ||
        !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')
      )
        return false;
      if (Number(response.headers.get('content-length')) > 1024 || !response.body) return false;
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 1024) return false;
        chunks.push(Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))?.ready === true;
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    controller.abort();
  }
}
export function createCompanionServer({
  token,
  resolve = resolveReference,
  convert = convertAudio,
  converterHealth = probeConverter,
} = {}) {
  if (
    typeof token !== 'string' ||
    token.length < 32 ||
    token.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  )
    throw new Error('Configure NYVEMI_COMPANION_TOKEN with32–256random URL-safe characters');
  const tokenHash = hash(token);
  let active = 0;
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController(),
      stop = () => controller.abort();
    res.once('close', stop);
    req.once('aborted', stop);
    let acquired = false;
    try {
      authorized(req, tokenHash);
      const health =
        ['/health', '/v1/health'].includes(req.url) && ['GET', 'POST'].includes(req.method);
      if (health) {
        let converterReady = false;
        try {
          converterReady = (await converterHealth({ signal: controller.signal })) === true;
        } catch {}
        if (controller.signal.aborted) return;
        send(res, 200, {
          ok: true,
          converterReady,
          service: 'nyvemi-voice-companion',
          version: 1,
          openVoice: 'http://127.0.0.1:8000',
          referenceUsage: 'preview',
        });
        return;
      }
      if (req.method !== 'POST' || !['/v1/reference/resolve', '/v1/convert'].includes(req.url))
        throw new CompanionError(404, '接口不存在');
      if (active >= 2) throw new CompanionError(429, '本地语音任务繁忙');
      active++;
      acquired = true;
      const body = await jsonBody(req, controller.signal);
      controller.signal.throwIfAborted();
      let result;
      if (req.url === '/v1/reference/resolve') {
        if (Object.keys(body).some((k) => !['query', 'urls'].includes(k)))
          throw new CompanionError(400, '请求字段无效');
        result = await resolve(body, { signal: controller.signal });
      } else {
        if (Object.keys(body).some((k) => !['sourceWavBase64', 'referenceWavBase64'].includes(k)))
          throw new CompanionError(400, '请求字段无效');
        result = await convert(
          decodeWav(body.sourceWavBase64),
          decodeWav(body.referenceWavBase64),
          { signal: controller.signal },
        );
      }
      controller.signal.throwIfAborted();
      send(res, 200, result);
    } catch (error) {
      if (!controller.signal.aborted)
        send(res, error instanceof CompanionError ? error.status : 500, {
          error: error instanceof CompanionError ? error.message : '本地语音服务未完成请求',
        });
    } finally {
      if (acquired) active--;
      res.removeListener('close', stop);
      req.removeListener('aborted', stop);
      controller.abort();
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 150000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = createCompanionServer({ token: process.env.NYVEMI_COMPANION_TOKEN });
    server.listen(PORT, HOST, () => console.log('Nyvemi voice companion ready on127.0.0.1:4319'));
    server.on('error', () => {
      console.error('Companion could not bind loopback port');
      process.exitCode = 1;
    });
  } catch {
    console.error('Set a valid NYVEMI_COMPANION_TOKEN before starting');
    process.exitCode = 1;
  }
}
