import { describe, it, expect } from 'vitest';
import { tuneSpeechWav, type LocalVoiceTuning } from '../src/speech/local-tuning';

const neutral: LocalVoiceTuning = {
  pitch: 0,
  warmth: 0,
  brightness: 0,
  presence: 0,
  air: 0,
  speed: 1,
  volume: 1,
};
function wav({
  rate = 24000,
  seconds = 0.4,
  hz = 220,
  channels = 1,
  amplitude = 0.2,
  frames = Math.round(rate * seconds),
} = {}): Uint8Array {
  const b = new Uint8Array(44 + frames * channels * 2),
    v = new DataView(b.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  v.setUint32(4, b.length - 8, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, frames * channels * 2, true);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++)
      v.setInt16(
        44 + (i * channels + c) * 2,
        Math.round(
          amplitude * Math.sin((2 * Math.PI * hz * i) / rate) * 32767 * (c === 1 ? -1 : 1),
        ),
        true,
      );
  return b;
}
function channel(b: Uint8Array, c = 0): number[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength),
    count = v.getUint16(22, true);
  return Array.from(
    { length: (b.length - 44) / (count * 2) },
    (_, i) => v.getInt16(44 + (i * count + c) * 2, true) / 32768,
  );
}
const tune = (b: Uint8Array, p: Partial<LocalVoiceTuning> = {}) =>
  tuneSpeechWav(b, { ...neutral, ...p }, new AbortController().signal);
function frequency(x: number[], rate = 24000): number {
  const start = Math.floor(x.length * 0.15),
    end = Math.floor(x.length * 0.85);
  let first = -1,
    last = -1,
    crossings = 0;
  for (let i = start + 1; i < end; i++)
    if (x[i - 1] <= 0 && x[i] > 0) {
      if (first < 0) first = i;
      last = i;
      crossings++;
    }
  return ((crossings - 1) * rate) / (last - first);
}
const rms = (x: number[]) =>
  Math.sqrt(x.slice(200).reduce((sum, y) => sum + y * y, 0) / (x.length - 200));
describe('local PCM WAV tuning', () => {
  it('neutral preserves identical object, bytes, metadata and nonzero byteOffset', async () => {
    const base = wav(),
      withMetadata = new Uint8Array(base.length + 10);
    withMetadata.set(base.subarray(0, 36));
    withMetadata.set([74, 85, 78, 75, 1, 0, 0, 0, 123, 0], 36);
    withMetadata.set(base.subarray(36), 46);
    new DataView(withMetadata.buffer).setUint32(4, withMetadata.length - 8, true);
    const container = new Uint8Array(withMetadata.length + 14);
    container.set(withMetadata, 7);
    const view = container.subarray(7, 7 + withMetadata.length),
      before = container.slice();
    expect(await tune(view)).toBe(view);
    expect(container).toEqual(before);
    expect((await tune(view, { volume: 0.5 })).length).toBe(base.length);
  });
  it('speed changes duration without pitch; pitch changes frequency without duration', async () => {
    const input = wav({ seconds: 1 });
    const fast = await tune(input, { speed: 1.3 }),
      slow = await tune(input, { speed: 0.7 });
    expect(channel(fast).length).toBe(Math.round(24000 / 1.3));
    expect(channel(slow).length).toBe(Math.round(24000 / 0.7));
    expect(frequency(channel(fast))).toBeCloseTo(220, -1);
    expect(frequency(channel(slow))).toBeCloseTo(220, -1);
    const pitched = await tune(input, { pitch: 4 });
    expect(pitched.length).toBe(input.length);
    expect(Math.abs(frequency(channel(pitched)) - 220 * 2 ** (4 / 12))).toBeLessThan(5);
    const combined = await tune(input, { pitch: -4, speed: 1.3 });
    expect(combined.length).toBe(fast.length);
    expect(Math.abs(frequency(channel(combined)) - 220 * 2 ** (-4 / 12))).toBeLessThan(5);
  });
  it.each([
    ['warmth', 100],
    ['brightness', 6000],
    ['presence', 1800],
    ['air', 10000],
  ] as const)('%s has real positive and negative EQ', async (name, hz) => {
    const input = wav({ hz }),
      original = rms(channel(input));
    expect(rms(channel(await tune(input, { [name]: 100 })))).toBeGreaterThan(original * 1.2);
    expect(rms(channel(await tune(input, { [name]: -100 })))).toBeLessThan(original * 0.85);
  });
  it('volume works, linked limiter prevents clipping, input immutable, stereo phase linked', async () => {
    const input = wav({ seconds: 0.5, channels: 2 }),
      before = input.slice();
    const quieter = await tune(input, { volume: 0.5 });
    expect(rms(channel(quieter)) / rms(channel(input))).toBeCloseTo(0.5, 3);
    const output = await tune(input, {
      pitch: 3,
      speed: 0.8,
      warmth: 100,
      brightness: 100,
      volume: 1.5,
    });
    const left = channel(output),
      right = channel(output, 1);
    expect(left.every((v, i) => Math.abs(v + right[i]) < 0.0001)).toBe(true);
    expect(left.every((v) => Number.isFinite(v) && Math.abs(v) <= 0.9991)).toBe(true);
    expect(input).toEqual(before);
    expect(channel(await tune(input, { volume: 0 })).every((v) => v === 0)).toBe(true);
  });
  it('clamps values and defaults nonfinite settings safely; tiny buffers remain valid', async () => {
    expect(await tune(wav(), { pitch: Infinity, speed: NaN, volume: NaN })).toEqual(wav());
    const input = wav({ frames: 1, channels: 2 });
    const output = await tune(input, { pitch: 999, speed: -99, air: 999, volume: Infinity });
    expect(output.length).toBeGreaterThanOrEqual(48);
    expect(channel(output).every(Number.isFinite)).toBe(true);
  });
  it('rejects bad PCM, stereo metadata, truncation, RIFF size, rate, oversized and overlong data', async () => {
    const input = wav();
    for (const modify of [
      (v: DataView) => v.setUint16(20, 3, true),
      (v: DataView) => v.setUint16(22, 3, true),
      (v: DataView) => v.setUint16(34, 24, true),
      (v: DataView) => v.setUint32(24, 192000, true),
      (v: DataView) => v.setUint32(28, 1, true),
      (v: DataView) => v.setUint32(4, 0, true),
      (v: DataView) => v.setUint32(40, 0xffffffff, true),
    ]) {
      const bad = input.slice();
      modify(new DataView(bad.buffer));
      await expect(tune(bad)).rejects.toThrow();
    }
    await expect(tune(input.subarray(0, -1))).rejects.toThrow();
    await expect(tune(wav({ seconds: 31 }))).rejects.toThrow();
    await expect(tune(new Uint8Array(8 * 1024 * 1024 + 1))).rejects.toThrow();
  });
  it('honors pre-cancel even neutral and yields promptly for cancellation during processing', async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(tuneSpeechWav(wav(), neutral, pre.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const c = new AbortController(),
      input = wav({ seconds: 5 }),
      before = input.slice(),
      start = Date.now();
    const promise = tuneSpeechWav(input, { ...neutral, pitch: 4, warmth: 100 }, c.signal);
    setTimeout(() => c.abort(), 3);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - start).toBeLessThan(500);
    expect(input).toEqual(before);
  });
});
