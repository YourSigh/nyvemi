/**
 * Local listening effects, not neural voice cloning. Windowed-sinc resampling
 * plus WSOLA separates pitch from speed; extreme settings may create artifacts.
 * No AudioContext, network, Node buffers, mutation, or external dependencies.
 */
export type LocalVoiceTuning = {
  pitch: number;
  warmth: number;
  brightness: number;
  presence: number;
  air: number;
  speed: number;
  volume: number;
};
const EQ_NAMES = ['warmth', 'brightness', 'presence', 'air'] as const;
const MAX_BYTES = 8 * 1024 * 1024;
function check(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('语音处理已取消');
    error.name = 'AbortError';
    throw error;
  }
}
async function checkpoint(signal: AbortSignal): Promise<void> {
  check(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  check(signal);
}
const clamp = (value: number, low: number, high: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
function parseWav(wav: Uint8Array): {
  view: DataView;
  channels: number;
  rate: number;
  frames: number;
  start: number;
} {
  const bad = (): never => {
    throw new TypeError('需要完整的单声道或双声道 PCM16 WAV（8–48kHz，最长30秒）');
  };
  if (!(wav instanceof Uint8Array) || wav.byteLength < 44 || wav.byteLength > MAX_BYTES) bad();
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE' || view.getUint32(4, true) !== wav.byteLength - 8)
    bad();
  let fmt = false,
    start = -1,
    bytes = 0,
    channels = 0,
    rate = 0,
    off = 12,
    chunks = 0;
  while (off + 8 <= wav.byteLength) {
    if (++chunks > 1024) bad();
    const name = text(off),
      size = view.getUint32(off + 4, true),
      at = off + 8;
    if (at + size > wav.byteLength) bad();
    if (name === 'fmt ') {
      if (fmt || size < 16 || view.getUint16(at, true) !== 1) bad();
      fmt = true;
      channels = view.getUint16(at + 2, true);
      rate = view.getUint32(at + 4, true);
      if (
        ![1, 2].includes(channels) ||
        rate < 8000 ||
        rate > 48000 ||
        view.getUint16(at + 14, true) !== 16 ||
        view.getUint16(at + 12, true) !== channels * 2 ||
        view.getUint32(at + 8, true) !== rate * channels * 2
      )
        bad();
    }
    if (name === 'data') {
      if (start !== -1 || size === 0) bad();
      start = at;
      bytes = size;
    }
    off = at + size + (size % 2);
  }
  if (off !== wav.byteLength || !fmt || start < 0 || bytes % (channels * 2) !== 0) bad();
  const frames = bytes / (channels * 2);
  if (frames < 1 || frames > rate * 30) bad();
  return { view, channels, rate, frames, start };
}
async function resample(
  input: Float32Array,
  ratio: number,
  signal: AbortSignal,
): Promise<Float32Array> {
  const size = Math.max(1, Math.round(input.length / ratio)),
    out = new Float32Array(size);
  // Windowed-sinc interpolation; cutoff protects pitch-up from aliasing.
  const radius = 12,
    cutoff = Math.min(1, 1 / ratio) * 0.94;
  for (let i = 0; i < size; i++) {
    const pos = i * ratio,
      base = Math.floor(pos);
    let value = 0,
      weight = 0;
    for (let j = base - radius + 1; j <= base + radius; j++) {
      const d = pos - j;
      if (Math.abs(d) >= radius) continue;
      const x = Math.PI * d * cutoff;
      const w =
        (Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x) * (0.5 + 0.5 * Math.cos((Math.PI * d) / radius));
      const at = Math.min(input.length - 1, Math.max(0, j));
      value += input[at] * w;
      weight += w;
    }
    out[i] = weight ? value / weight : 0;
    if (i > 0 && i % 4096 === 0) await checkpoint(signal);
  }
  return out;
}

async function stretch(
  channels: Float32Array[],
  length: number,
  sampleRate: number,
  signal: AbortSignal,
): Promise<Float32Array[]> {
  const n = channels[0].length;
  if (n === length) return channels;
  // Small buffers cannot contain a useful pitch period. Repeat/interpolate their
  // few samples safely rather than allocating an invalid overlap window.
  if (n < 32)
    return channels.map((a) => {
      const b = new Float32Array(length);
      for (let i = 0; i < length; i++) b[i] = a[Math.min(n - 1, Math.floor((i * n) / length))];
      return b;
    });
  const frame = Math.min(Math.round(sampleRate * 0.04), Math.floor(n / 2));
  const hop = Math.max(1, Math.floor(frame / 2)),
    overlap = frame - hop;
  const search = Math.min(Math.round(sampleRate * 0.012), Math.floor(frame / 2));
  const ratio = length / n,
    outs = channels.map(() => new Float32Array(length));
  for (let c = 0; c < channels.length; c++)
    outs[c].set(channels[c].subarray(0, Math.min(frame, length)));
  // Select the strongest channel for matching; all channels share the same shifts
  // to preserve stereo phase. Normalized matching avoids favoring loud regions.
  let guide = 0,
    maxEnergy = -1;
  for (let c = 0; c < channels.length; c++) {
    let e = 0;
    for (let i = 0; i < n; i += 16) e += channels[c][i] ** 2;
    if (e > maxEnergy) {
      maxEnergy = e;
      guide = c;
    }
  }
  let frames = 0;
  for (let outPos = hop; outPos < length; outPos += hop) {
    const expected = Math.min(n - frame, Math.max(0, Math.round(outPos / ratio)));
    let best = expected,
      bestScore = -Infinity;
    const lo = Math.max(0, expected - search),
      hi = Math.min(n - frame, expected + search);
    const count = Math.min(overlap, length - outPos),
      src = channels[guide],
      dst = outs[guide];
    const score = (pos: number) => {
      let dot = 0,
        a = 0,
        b = 0;
      for (let k = 0; k < count; k += 8) {
        const x = dst[outPos + k],
          y = src[pos + k];
        dot += x * y;
        a += x * x;
        b += y * y;
      }
      return a * b > 1e-16
        ? dot / Math.sqrt(a * b) - Math.abs(pos - expected) * 1e-7
        : -Math.abs(pos - expected) * 1e-7;
    };
    for (let pos = lo; pos <= hi; pos += 4) {
      const s = score(pos);
      if (s > bestScore) {
        bestScore = s;
        best = pos;
      }
    }
    const coarse = best;
    for (let pos = Math.max(lo, coarse - 3); pos <= Math.min(hi, coarse + 3); pos++) {
      const s = score(pos);
      if (s > bestScore) {
        bestScore = s;
        best = pos;
      }
    }
    for (let c = 0; c < channels.length; c++) {
      for (let k = 0; k < frame && outPos + k < length; k++) {
        const x = channels[c][best + k];
        const fade = k < overlap ? 0.5 - 0.5 * Math.cos((Math.PI * k) / overlap) : 1;
        outs[c][outPos + k] = outs[c][outPos + k] * (1 - fade) + x * fade;
      }
    }
    if (++frames % 4 === 0) await checkpoint(signal);
  }
  return outs;
}

// RBJ peaking/shelf coefficients, normalized by a0.
function coefficients(
  type: 'peak' | 'low' | 'high',
  freq: number,
  db: number,
  rate: number,
): number[] {
  const A = 10 ** (db / 40),
    w = (2 * Math.PI * Math.min(freq, rate * 0.45)) / rate,
    c = Math.cos(w),
    s = Math.sin(w);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peak') {
    const alpha = s / (2 * 0.75);
    b0 = 1 + alpha * A;
    b1 = -2 * c;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * c;
    a2 = 1 - alpha / A;
  } else {
    const alpha = s / Math.sqrt(2),
      t = 2 * Math.sqrt(A) * alpha;
    if (type === 'low') {
      b0 = A * (A + 1 - (A - 1) * c + t);
      b1 = 2 * A * (A - 1 - (A + 1) * c);
      b2 = A * (A + 1 - (A - 1) * c - t);
      a0 = A + 1 + (A - 1) * c + t;
      a1 = -2 * (A - 1 + (A + 1) * c);
      a2 = A + 1 + (A - 1) * c - t;
    } else {
      b0 = A * (A + 1 + (A - 1) * c + t);
      b1 = -2 * A * (A - 1 + (A + 1) * c);
      b2 = A * (A + 1 + (A - 1) * c - t);
      a0 = A + 1 - (A - 1) * c + t;
      a1 = 2 * (A - 1 - (A + 1) * c);
      a2 = A + 1 - (A - 1) * c - t;
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
async function filter(data: Float32Array, coeff: number[], signal: AbortSignal): Promise<void> {
  const [b0, b1, b2, a1, a2] = coeff;
  let z1 = 0,
    z2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i],
      y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    data[i] = y;
    if (i > 0 && i % 8192 === 0) await checkpoint(signal);
  }
}

/** Neutral settings return the identical validated byte view, including metadata.
 * Non-neutral output is canonical interleaved PCM16 WAV; original is never mutated.
 * Inputs: <=30s, mono/stereo,8–48kHz,8MiB. Speed .7 may extend output to42.86s.
 */
export async function tuneSpeechWav(
  wav: Uint8Array,
  tuning: LocalVoiceTuning,
  signal: AbortSignal,
): Promise<Uint8Array> {
  check(signal);
  const info = parseWav(wav);
  const p: LocalVoiceTuning = {
    pitch: clamp(tuning.pitch, -4, 4, 0),
    speed: clamp(tuning.speed, 0.7, 1.3, 1),
    volume: clamp(tuning.volume, 0, 1.5, 1),
    warmth: clamp(tuning.warmth, -100, 100, 0),
    brightness: clamp(tuning.brightness, -100, 100, 0),
    presence: clamp(tuning.presence, -100, 100, 0),
    air: clamp(tuning.air, -100, 100, 0),
  };
  if (p.pitch === 0 && p.speed === 1 && p.volume === 1 && EQ_NAMES.every((k) => p[k] === 0)) {
    check(signal);
    return wav;
  }
  const { rate, frames, start, view } = info,
    target = Math.max(1, Math.round(frames / p.speed));
  let channels: Float32Array[] = Array.from(
    { length: info.channels },
    () => new Float32Array(frames),
  );
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < info.channels; c++) {
      const value = view.getInt16(start + (i * info.channels + c) * 2, true);
      channels[c][i] = value / (value < 0 ? 32768 : 32767);
    }
    if (i > 0 && i % 8192 === 0) await checkpoint(signal);
  }
  const pitchRatio = 2 ** (p.pitch / 12);
  if (p.pitch !== 0) {
    for (let c = 0; c < channels.length; c++) {
      channels[c] = await resample(channels[c], pitchRatio, signal);
      await checkpoint(signal);
    }
  }
  if (channels[0].length !== target) channels = await stretch(channels, target, rate, signal);
  const bands: [(typeof EQ_NAMES)[number], 'low' | 'high' | 'peak', number, number][] = [
    ['warmth', 'low', 250, 6],
    ['brightness', 'high', 3200, 6],
    ['presence', 'peak', 1800, 5],
    ['air', 'high', 8000, 5],
  ];
  for (const [name, type, freq, gain] of bands) {
    if (p[name] !== 0) {
      const co = coefficients(type, freq, (p[name] * gain) / 100, rate);
      for (const data of channels) await filter(data, co, signal);
    }
  }
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i] * p.volume));
      if (i > 0 && i % 8192 === 0) await checkpoint(signal);
    }
  }
  const gain = p.volume * (peak > 0.999 ? 0.999 / peak : 1);
  const bytes = target * channels.length * 2,
    out = new Uint8Array(44 + bytes),
    v = new DataView(out.buffer);
  const ascii = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) v.setUint8(at + i, value.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels.length, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels.length * 2, true);
  v.setUint16(32, channels.length * 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, bytes, true);
  for (let i = 0; i < target; i++) {
    for (let c = 0; c < channels.length; c++) {
      const x = Number.isFinite(channels[c][i])
        ? Math.max(-1, Math.min(1, channels[c][i] * gain))
        : 0;
      v.setInt16(44 + (i * channels.length + c) * 2, Math.round(x * (x < 0 ? 32768 : 32767)), true);
    }
    if (i > 0 && i % 8192 === 0) await checkpoint(signal);
  }
  check(signal);
  return out;
}
