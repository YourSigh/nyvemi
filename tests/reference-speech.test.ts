import { describe, it, expect, vi } from 'vitest';
import { assertReferenceWav, createReferenceTransport } from '../src/speech/reference-transport';
import { createReferenceSpeechDriver } from '../src/speech/reference-driver';
function wav() {
  const a = new Uint8Array(1644),
    v = new DataView(a.buffer);
  for (const [i, s] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const)
    for (let j = 0; j < s.length; j++) a[i + j] = s.charCodeAt(j);
  v.setUint32(4, 1636, true);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  v.setUint32(40, 1600, true);
  return a;
}
const signal = () => new AbortController().signal;
const options = { enabled: true, rate: 1, pitch: 1, referenceVoice: { id: 'r1', label: 'Ref' } };
const response = () => new Response(wav(), { headers: { 'content-type': 'audio/wav' } });
describe('reference transport', () => {
  it('validates complete bounded PCM WAV', () => {
    expect(() => assertReferenceWav(wav())).not.toThrow();
    expect(() => assertReferenceWav(wav().subarray(1))).toThrow();
    const b = wav();
    b[34] = 32;
    expect(() => assertReferenceWav(b)).toThrow();
    expect(() => assertReferenceWav(wav(), 0.01)).toThrow();
  });
  it('isolates official and companion authorization and forbids redirects', async () => {
    const fetcher = vi.fn(async (url: unknown) =>
      String(url).endsWith('/tools/tts')
        ? new Response(new Uint8Array(48000), { headers: { 'content-type': 'audio/pcm' } })
        : response(),
    );
    const t = createReferenceTransport({
      getDeepSeekKey: () => 'official-test',
      getCompanion: () => ({ baseUrl: 'https://voice.example', token: 'companion-test' }),
      fetch: fetcher,
    });
    await t.synthesize('你好', signal());
    await t.convert(wav(), wav(), signal());
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('https://api.deepseek.com/v1/tools/tts');
    expect(calls[1][0]).toBe('https://voice.example/v1/convert');
    expect(calls[0][1].headers).toHaveProperty('Authorization', 'Bearer official-test');
    expect(calls[1][1].headers).toHaveProperty('Authorization', 'Bearer companion-test');
    expect(calls.every((c) => c[1].redirect === 'error')).toBe(true);
    expect(calls[1][1].body).not.toContain('official-test');
  });
  it('does not expose upstream error text', async () => {
    const t = createReferenceTransport({
      getDeepSeekKey: () => 'test',
      getCompanion: () => undefined,
      fetch: vi.fn(async () => new Response('secret upstream', { status: 500 })),
    });
    await expect(t.synthesize('x', signal())).rejects.toThrow('语音服务请求失败');
  });
  it('requires opt-in for loopback and blocks other HTTP', async () => {
    for (const host of ['http://127.0.0.1:8000', 'http://example.org']) {
      const fetcher = vi.fn();
      const t = createReferenceTransport({
        getDeepSeekKey: () => undefined,
        getCompanion: () => ({ baseUrl: host, token: 'test' }),
        fetch: fetcher,
      });
      await expect(t.convert(wav(), wav(), signal())).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it('resolves without a DeepSeek key and preserves preview-only usage', async () => {
    const getKey = vi.fn();
    const t = createReferenceTransport({
      getDeepSeekKey: getKey,
      getCompanion: () => ({ baseUrl: 'https://voice.example', token: 'test' }),
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              label: 'preview',
              sourceUrl: 'https://example.org/audio',
              usage: 'preview',
              wavBase64: Buffer.from(wav()).toString('base64'),
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    });
    expect((await t.resolveReference('角色')).usage).toBe('preview');
    expect(getKey).not.toHaveBeenCalled();
  });
  it('rejects invalid MIME and oversize declarations', async () => {
    for (const headers of [
      { 'content-type': 'text/html' },
      { 'content-type': 'audio/wav', 'content-length': '999999999' },
    ]) {
      const t = createReferenceTransport({
        getDeepSeekKey: () => 'test',
        getCompanion: () => undefined,
        fetch: vi.fn(
          async () => new Response('bad', { headers: headers as Record<string, string> }),
        ),
      });
      await expect(t.synthesize('x', signal())).rejects.toThrow();
    }
  });
  it('does not fetch pre-aborted request', async () => {
    const f = vi.fn(),
      c = new AbortController();
    c.abort();
    const t = createReferenceTransport({
      getDeepSeekKey: () => 'test',
      getCompanion: () => undefined,
      fetch: f,
    });
    await expect(t.synthesize('x', c.signal)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
function fixture() {
  const fallback = { play: vi.fn(async () => true), stop: vi.fn(async () => {}) };
  const transport = {
    checkCompanion: vi.fn(async () => true),
    synthesize: vi.fn(async () => wav()),
    convert: vi.fn(async () => wav()),
    resolveReference: vi.fn(),
    search: vi.fn(),
  };
  const playWav = vi.fn(async () => true),
    loadReference = vi.fn(async () => wav()),
    onFallback = vi.fn();
  const d = createReferenceSpeechDriver({
    transport,
    fallback,
    playWav,
    loadReference,
    onFallback,
  });
  return { d, transport, fallback, playWav, loadReference, onFallback };
}
describe('reference driver', () => {
  it('reuses first-sentence preparation', async () => {
    const f = fixture();
    expect(await f.d.prepare!('a:0', '你好', options)).toBe(true);
    expect(await f.d.play('a:0', '你好', options)).toBe(true);
    expect(f.transport.synthesize).toHaveBeenCalledTimes(1);
    expect(f.fallback.play).not.toHaveBeenCalled();
  });
  it('changed text/profile cannot reuse old preparation', async () => {
    const f = fixture();
    await f.d.prepare!('a', '旧', options);
    await f.d.play('a', '新', options);
    expect(f.transport.synthesize).toHaveBeenCalledTimes(2);
  });
  it('missing or failed companion keeps DeepSeek audio without a duplicate synthesis', async () => {
    for (const available of [false, true]) {
      const f = fixture();
      f.transport.checkCompanion.mockResolvedValueOnce(available);
      f.transport.convert.mockRejectedValueOnce(Error('private detail'));
      expect(await f.d.play('a', 'text', options)).toBe(true);
      expect(f.transport.synthesize).toHaveBeenCalledOnce();
      expect(f.transport.convert).toHaveBeenCalledTimes(available ? 1 : 0);
      expect(f.playWav).toHaveBeenCalledOnce();
      expect(f.fallback.play).not.toHaveBeenCalled();
      expect(f.onFallback).toHaveBeenCalledWith(
        '未完成参考换声：正在播放 DeepSeek 原声，不是转换后的声音',
      );
    }
  });
  it('when DeepSeek itself fails, uses the system fallback visibly', async () => {
    const f = fixture();
    f.transport.synthesize.mockRejectedValueOnce(Error('private detail'));
    expect(await f.d.play('a', 'text', options)).toBe(true);
    expect(f.fallback.play).toHaveBeenCalledOnce();
    expect(f.onFallback).toHaveBeenCalledWith('DeepSeek 语音暂不可用，已切换系统离线声音');
  });
  it('stop during synthesis suppresses playback and fallback', async () => {
    const f = fixture();
    let finish!: (v: Uint8Array<ArrayBuffer>) => void;
    f.transport.synthesize.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const p = f.d.play('a', 'text', options);
    await f.d.stop();
    finish(wav());
    expect(await p).toBe(false);
    expect(f.playWav).not.toHaveBeenCalled();
    expect(f.fallback.play).not.toHaveBeenCalled();
  });
  it('ordinary DeepSeek voice needs no companion and tunes PCM before playback', async () => {
    const f = fixture(),
      input = wav(),
      samples = new DataView(input.buffer);
    for (let i = 44; i < input.length; i += 2) samples.setInt16(i, 8192, true);
    f.transport.synthesize.mockResolvedValueOnce(input);
    await f.d.play('a', 'text', {
      enabled: true,
      rate: 1,
      pitch: 1,
      deepSeekVoice: 'tide',
      localTuning: { pitch: 0, warmth: 0, brightness: 0, presence: 0, air: 0, speed: 1, volume: 0 },
    });
    expect(f.fallback.play).not.toHaveBeenCalled();
    expect(f.transport.synthesize).toHaveBeenCalledWith('text', expect.any(AbortSignal), 'tide');
    expect(f.transport.checkCompanion).not.toHaveBeenCalled();
    expect(f.transport.convert).not.toHaveBeenCalled();
    const played = (f.playWav.mock.calls as unknown as [string, Uint8Array][])[0][1];
    expect(played.subarray(44).every((n) => n === 0)).toBe(true);
    expect(input.subarray(44).some((n) => n !== 0)).toBe(true);
  });
});

it('health is separately authenticated, bounded to 2.5s even when transport ignores abort', async () => {
  vi.useFakeTimers();
  try {
    const f = vi.fn(() => new Promise<Response>(() => {}));
    const t = createReferenceTransport({
      getDeepSeekKey: () => undefined,
      getCompanion: () => ({ baseUrl: 'https://voice.example', token: 'health-test' }),
      fetch: f,
    });
    const p = t.checkCompanion();
    await vi.advanceTimersByTimeAsync(2600);
    expect(await p).toBe(false);
    expect(f).toHaveBeenCalledWith(
      'https://voice.example/health',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer health-test' }),
      }),
    );
  } finally {
    vi.useRealTimers();
  }
});
it('abort rejects promptly even if native fetch ignores signal', async () => {
  const f = vi.fn(() => new Promise<Response>(() => {})),
    c = new AbortController();
  const t = createReferenceTransport({
    getDeepSeekKey: () => 'test',
    getCompanion: () => undefined,
    fetch: f,
  });
  const p = t.synthesize('hello', c.signal);
  await Promise.resolve();
  await Promise.resolve();
  c.abort();
  await expect(p).rejects.toThrow();
});

describe('opt-in local reference conversion', () => {
  function localFixture(enabled = true, available = true) {
    const source = wav();
    const converted = wav();
    converted[44] = 42;
    const transport = {
      checkCompanion: vi.fn(async () => true),
      synthesize: vi.fn(async () => source),
      convert: vi.fn(async () => converted),
      resolveReference: vi.fn(),
      search: vi.fn(),
    };
    const localConversion = {
      state: vi.fn(async () => ({ enabled, available })),
      convert: vi.fn(async () => converted),
      cancel: vi.fn(async () => {}),
    };
    const playWav = vi.fn(async () => true);
    const fallback = { play: vi.fn(async () => true), stop: vi.fn(async () => {}) };
    const driver = createReferenceSpeechDriver({
      transport,
      localConversion,
      loadReference: async () => wav(),
      playWav,
      fallback,
    });
    return { source, converted, transport, localConversion, playWav, fallback, driver };
  }
  it('uses only the on-device converter when enabled', async () => {
    const f = localFixture();
    expect(await f.driver.play('a', 'hello', options)).toBe(true);
    expect(f.localConversion.convert).toHaveBeenCalledOnce();
    expect(f.playWav).toHaveBeenCalledWith('a', f.converted);
    expect(f.transport.checkCompanion).not.toHaveBeenCalled();
    expect(f.transport.convert).not.toHaveBeenCalled();
    expect(f.transport.synthesize).toHaveBeenCalledOnce();
  });
  it.each(['missing', 'failed', 'state-failed'])(
    'fails closed to the same source on %s, never remote',
    async (mode) => {
      const f = localFixture(true, mode !== 'missing');
      if (mode === 'failed') f.localConversion.convert.mockRejectedValue(Error('failure'));
      if (mode === 'state-failed') f.localConversion.state.mockRejectedValue(Error('failure'));
      expect(await f.driver.play('a', 'hello', options)).toBe(true);
      expect(f.playWav).toHaveBeenCalledWith('a', f.source);
      expect(f.transport.checkCompanion).not.toHaveBeenCalled();
      expect(f.transport.convert).not.toHaveBeenCalled();
      expect(f.fallback.play).not.toHaveBeenCalled();
      expect(f.transport.synthesize).toHaveBeenCalledOnce();
    },
  );
  it('retains explicit remote mode when local is disabled', async () => {
    const f = localFixture(false);
    await f.driver.play('a', 'hello', options);
    expect(f.transport.convert).toHaveBeenCalledOnce();
    expect(f.localConversion.convert).not.toHaveBeenCalled();
  });
  it('rechecks privacy mode when local is enabled during pending synthesis', async () => {
    const f = localFixture(false);
    let finish!: (bytes: ReturnType<typeof wav>) => void;
    f.transport.synthesize.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.driver.play('a', 'hello', options);
    await vi.waitFor(() => expect(f.transport.checkCompanion).toHaveBeenCalledOnce());
    f.localConversion.state.mockResolvedValue({ enabled: true, available: true });
    finish(f.source);
    expect(await pending).toBe(true);
    expect(f.transport.convert).not.toHaveBeenCalled();
    expect(f.localConversion.convert).toHaveBeenCalledOnce();
  });
  it('cancels local work and never plays a late converted result', async () => {
    const f = localFixture();
    let finish!: (bytes: ReturnType<typeof wav>) => void;
    f.localConversion.convert.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.driver.play('a', 'hello', options);
    await vi.waitFor(() => expect(f.localConversion.convert).toHaveBeenCalledOnce());
    await f.driver.stop();
    finish(f.converted);
    expect(await pending).toBe(false);
    expect(f.localConversion.cancel).toHaveBeenCalledOnce();
    expect(f.playWav).not.toHaveBeenCalled();
    expect(f.fallback.play).not.toHaveBeenCalled();
  });
});
