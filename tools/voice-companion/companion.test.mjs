import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createCompanionServer, authorized, probeConverter } from './server.mjs';
import { wavInfo, decodeWav, normalizeAudio, convertAudio } from './audio.mjs';
import { referenceCandidates, resolveReference } from './reference.mjs';
import { fetchPublicResource } from './generic-preview.mjs';
const token = 'test_only_companion_0123456789_abcdef',
  tokenHash = createHash('sha256').update(token).digest();
function wav(seconds = 0.1) {
  const b = Buffer.alloc(44 + Math.floor(16000 * seconds) * 2);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(b.length - 44, 40);
  return b;
}
async function call(server, path, body = {}, extra = {}, method = 'POST') {
  const bytes = Buffer.from(JSON.stringify(body));
  const headers = {
    host: '127.0.0.1:4319',
    authorization: 'Bearer ' + token,
    'content-type': 'application/json',
    'content-length': String(bytes.length),
    ...extra,
  };
  const req = Readable.from([bytes]);
  Object.assign(req, { headers, rawHeaders: Object.entries(headers).flat(), url: path, method });
  const res = new EventEmitter();
  res.destroyed = false;
  return new Promise((resolve) => {
    res.writeHead = (status, headers) => {
      res.status = status;
      res.headers = headers;
    };
    res.end = (bytes) => {
      res.bytes = bytes;
      resolve(res);
    };
    server.emit('request', req, res);
  });
}
test('token required, constant-size hash auth, exact host and no Origin including null', () => {
  assert.throws(() => createCompanionServer({ token: 'short' }));
  const req = {
    headers: { host: '127.0.0.1:4319', authorization: 'Bearer ' + token },
    rawHeaders: ['Host', '127.0.0.1:4319', 'Authorization', 'Bearer ' + token],
  };
  authorized(req, tokenHash);
  for (const change of [
    { host: 'localhost:4319' },
    { host: '127.0.0.1:8000' },
    { authorization: 'Bearer wrong' },
  ]) {
    assert.throws(() => authorized({ ...req, headers: { ...req.headers, ...change } }, tokenHash));
  }
  for (const origin of ['null', 'https://example.com', ''])
    assert.throws(() =>
      authorized({ ...req, rawHeaders: [...req.rawHeaders, 'Origin', origin] }, tokenHash),
    );
  assert.throws(() =>
    authorized(
      { ...req, rawHeaders: [...req.rawHeaders, 'Authorization', 'Bearer ' + token] },
      tokenHash,
    ),
  );
});
test('routes authenticated before resolver/converter; no binding needed for tests', async () => {
  let calls = 0;
  const server = createCompanionServer({
    token,
    converterHealth: async () => false,
    resolve: async () => {
      calls++;
      return { usage: 'preview' };
    },
  });
  assert.equal((await call(server, '/health', {}, {}, 'GET')).status, 200);
  assert.equal(
    (
      await call(
        server,
        '/v1/reference/resolve',
        { query: 'Ahri' },
        { authorization: 'Bearer bad' },
      )
    ).status,
    401,
  );
  assert.equal(
    (await call(server, '/v1/reference/resolve', { query: 'Ahri' }, { origin: 'null' })).status,
    403,
  );
  assert.equal(calls, 0);
  assert.equal((await call(server, '/v1/reference/resolve', { query: 'Ahri' })).status, 200);
  assert.equal(calls, 1);
  assert.equal(
    (await call(server, '/v1/reference/resolve', { query: 'Ahri', apiKey: 'not-accepted' })).status,
    400,
  );
  assert.equal((await call(server, '/v1/unknown')).status, 404);
  assert.equal(
    (
      await call(server, '/v1/convert', {
        sourceWavBase64: 'invalid',
        referenceWavBase64: 'invalid',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        server,
        '/v1/reference/resolve',
        {},
        { 'content-length': String(10 * 1024 * 1024) },
      )
    ).status,
    413,
  );
  assert.equal(
    (await call(server, '/v1/reference/resolve', {}, { 'content-encoding': 'gzip' })).status,
    415,
  );
  assert.equal(server.listening, false);
});
test('WAV validation rejects malformed, stereo, long, noncanonical base64', () => {
  assert.equal(wavInfo(wav()).sampleRate, 16000);
  assert.deepEqual(decodeWav(wav().toString('base64')), wav());
  for (const edit of [
    (b) => b.writeUInt16LE(2, 22),
    (b) => b.writeUInt16LE(3, 20),
    (b) => b.writeUInt32LE(1, 28),
    (b) => b.writeUInt32LE(0, 4),
  ]) {
    const b = wav();
    edit(b);
    assert.throws(() => wavInfo(b));
  }
  assert.throws(() => wavInfo(wav(31)));
  assert.throws(() => decodeWav(wav().toString('base64') + '\n'));
  assert.throws(() => decodeWav('not audio'));
});
test('reference bounds and preview-only: lookup never grants cloning authorization', async () => {
  assert(referenceCandidates('阿狸').urls[0].includes('/Ahri/'));
  assert.throws(() => referenceCandidates('x', Array(7).fill('https://example.com')));
  let calls = 0;
  const result = await resolveReference(
    { query: 'some game', urls: ['https://example.com/page'] },
    {
      preview: async () => {
        calls++;
        return { bytes: wav(), sourceUrl: 'https://example.com/page' };
      },
      normalize: async (b) => b,
    },
  );
  assert.equal(result.usage, 'preview');
  assert.equal(calls, 1);
  assert.equal(result.label, 'some game');
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    resolveReference(
      { query: 'Ahri' },
      {
        signal: c.signal,
        preview: async () => {
          calls++;
        },
      },
    ),
  );
  assert.equal(calls, 1);
});
test('secure raw BWIKI primitive checks DNS and returns complete page, not early HTML', async () => {
  let reads = 0;
  const bytes = Buffer.from('<audio src="/a.wav">' + ' '.repeat(17000));
  const result = await fetchPublicResource('https://example.com/page', {
    resolve: async () => [{ address: '1.1.1.1', family: 4 }],
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: (async function* () {
        reads++;
        yield bytes;
        reads++;
        yield Buffer.from('end');
      })(),
    }),
  });
  assert.equal(reads, 2);
  assert.equal(result.contentType, 'text/html');
  assert.equal(result.bytes.length, bytes.length + 3);
  await assert.rejects(
    fetchPublicResource('https://example.com/page', {
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
      request: async () => {
        throw Error('must not request');
      },
    }),
    (e) => e.status === 403,
  );
});
test('local converter fixed destination, no auth forwarding, valid output and abort/error sanitation', async () => {
  const transport = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/v1/audio/convert');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers, undefined);
    assert.deepEqual([...options.body.keys()], ['source', 'reference', 'model']);
    assert.equal(options.body.get('model'), 'openvoice');
    return new Response(wav(), { headers: { 'content-type': 'audio/wav' } });
  };
  assert.deepEqual(await convertAudio(wav(), wav(), { transport }), wav());
  await assert.rejects(
    convertAudio(wav(), wav(), {
      transport: async () => {
        throw Error('/private/token-secret');
      },
    }),
    (e) => e.status === 502 && !e.message.includes('secret'),
  );
  await assert.rejects(
    convertAudio(wav(), wav(), {
      transport: async () =>
        new Response(wav(), {
          status: 302,
          headers: { location: 'https://example.com', 'content-type': 'audio/wav' },
        }),
    }),
    (e) => e.status === 502,
  );
  const c = new AbortController();
  c.abort();
  let calls = 0;
  await assert.rejects(
    convertAudio(wav(), wav(), {
      signal: c.signal,
      transport: async () => {
        calls++;
      },
    }),
    (e) => e.status === 499,
  );
  assert.equal(calls, 0);
});
test('real installed ffmpeg normalizes only a synthetic WAV offline', async () => {
  const result = await normalizeAudio(wav());
  const info = wavInfo(result);
  assert.equal(info.sampleRate, 24000);
  assert(info.seconds > 0);
});

test('health reports converter readiness without sacrificing search liveness, and probe is fixed/local/bounded', async () => {
  for (const ready of [true, false]) {
    const server = createCompanionServer({ token, converterHealth: async () => ready });
    const response = await call(server, '/health', {}, {}, 'GET');
    const body = JSON.parse(response.bytes);
    assert.equal(body.ok, true);
    assert.equal(body.converterReady, ready);
  }
  const server = createCompanionServer({
    token,
    converterHealth: async () => {
      throw Error('private details');
    },
  });
  assert.equal(JSON.parse((await call(server, '/v1/health')).bytes).converterReady, false);
  const result = await probeConverter({
    transport: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:8000/health');
      assert.equal(options.headers, undefined);
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      return new Response(JSON.stringify({ ready: true }), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(result, true);
  assert.equal(
    await probeConverter({
      transport: async () =>
        new Response('x'.repeat(1025), { headers: { 'content-type': 'application/json' } }),
    }),
    false,
  );
  assert.equal(
    await probeConverter({
      transport: async () => {
        throw Error('network');
      },
    }),
    false,
  );
  const start = Date.now();
  assert.equal(
    await probeConverter({
      transport: async (_url, { signal }) =>
        new Promise((resolve, reject) =>
          signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }),
        ),
    }),
    false,
  );
  assert(Date.now() - start < 2000);
});
