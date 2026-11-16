import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export class CompanionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const AUDIO_CAP = 3 * 1024 * 1024;
export function wavInfo(b, maxSeconds = 30, acceptStereo = false) {
  const bad = () => {
    throw new CompanionError(400, '需要完整的 PCM16 WAV，时长不超过30秒');
  };
  if (
    !Buffer.isBuffer(b) ||
    b.length < 44 ||
    b.length > AUDIO_CAP ||
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.toString('ascii', 8, 12) !== 'WAVE' ||
    b.readUInt32LE(4) !== b.length - 8
  )
    bad();
  let fmt = null,
    data = 0,
    off = 12;
  while (off + 8 <= b.length) {
    const name = b.toString('ascii', off, off + 4),
      size = b.readUInt32LE(off + 4),
      start = off + 8;
    if (start + size > b.length) bad();
    if (name === 'fmt ') {
      if (fmt || size < 16) bad();
      fmt = {
        format: b.readUInt16LE(start),
        channels: b.readUInt16LE(start + 2),
        rate: b.readUInt32LE(start + 4),
        byteRate: b.readUInt32LE(start + 8),
        align: b.readUInt16LE(start + 12),
        bits: b.readUInt16LE(start + 14),
      };
    }
    if (name === 'data') {
      if (data || !size) bad();
      data = size;
    }
    off = start + size + (size % 2);
  }
  if (
    off !== b.length ||
    !fmt ||
    !data ||
    fmt.format !== 1 ||
    ![1, ...(acceptStereo ? [2] : [])].includes(fmt.channels) ||
    fmt.bits !== 16 ||
    fmt.rate < 8000 ||
    fmt.rate > 96000 ||
    fmt.align !== fmt.channels * 2 ||
    fmt.byteRate !== fmt.rate * fmt.align ||
    data % fmt.align ||
    data / fmt.byteRate > maxSeconds
  )
    bad();
  return { sampleRate: fmt.rate, seconds: data / fmt.byteRate };
}
export function decodeWav(value) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > Math.ceil(AUDIO_CAP / 3) * 4 ||
    value.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new CompanionError(400, 'WAV Base64 无效或过大');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new CompanionError(400, 'WAV Base64 编码无效');
  wavInfo(bytes, 30, true);
  return bytes;
}
export async function normalizeAudio(bytes, { signal, ffmpeg = '/opt/homebrew/bin/ffmpeg' } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 8 * 1024 * 1024)
    throw new CompanionError(413, '公开音频过大');
  signal?.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), 'nyvemi-voice-'));
  try {
    const input = join(dir, 'input'),
      output = join(dir, 'output.wav');
    await writeFile(input, bytes, { mode: 0o600 });
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-format_whitelist',
          'wav,ogg,mp3',
          '-i',
          input,
          '-map',
          '0:a:0',
          '-vn',
          '-sn',
          '-dn',
          '-map_metadata',
          '-1',
          '-t',
          '30',
          '-ac',
          '1',
          '-ar',
          '24000',
          '-c:a',
          'pcm_s16le',
          '-threads',
          '1',
          '-fs',
          '1500000',
          '-y',
          output,
        ],
        { stdio: 'ignore', signal, timeout: 20000, killSignal: 'SIGKILL' },
      );
      child.once('error', () =>
        reject(new CompanionError(signal?.aborted ? 499 : 502, '本地音频解码未完成')),
      );
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new CompanionError(signal?.aborted ? 499 : 502, '本地音频解码未完成')),
      );
    });
    signal?.throwIfAborted();
    const result = await readFile(output);
    wavInfo(result);
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function convertAudio(source, reference, { signal, transport = fetch } = {}) {
  const controller = new AbortController(),
    stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(stop, 120000);
  try {
    wavInfo(source, 30, true);
    wavInfo(reference, 30, true);
    controller.signal.throwIfAborted();
    const body = new FormData();
    body.set('source', new Blob([source], { type: 'audio/wav' }), 'source.wav');
    body.set('reference', new Blob([reference], { type: 'audio/wav' }), 'reference.wav');
    body.set('model', 'openvoice');
    const response = await transport('http://127.0.0.1:8000/v1/audio/convert', {
      method: 'POST',
      body,
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
    });
    try {
      if (
        response.status !== 200 ||
        !/^audio\/wav(?:;|$)/i.test(response.headers.get('content-type') || '')
      )
        throw new CompanionError(502, '本地 OpenVoice 尚未就绪或转换失败');
      const declared = response.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > AUDIO_CAP))
        throw new CompanionError(502, '本地转换输出超过限制');
      const chunks = [];
      let size = 0;
      if (!response.body) throw new CompanionError(502, '本地转换没有输出');
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > AUDIO_CAP) throw new CompanionError(502, '本地转换输出超过限制');
        chunks.push(Buffer.from(chunk));
      }
      if (declared && Number(declared) !== size)
        throw new CompanionError(502, '本地转换输出不完整');
      const bytes = Buffer.concat(chunks);
      wavInfo(bytes, 31);
      return bytes;
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  } catch (error) {
    if (signal?.aborted) throw new CompanionError(499, '请求已取消');
    if (controller.signal.aborted) throw new CompanionError(504, '本地转换超时');
    if (error instanceof CompanionError) throw error;
    throw new CompanionError(502, '无法连接本地 OpenVoice');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    controller.abort();
  }
}
