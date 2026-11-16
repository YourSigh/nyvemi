import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGenericPreview,
  isPublicAddress,
  detectAudioType,
  GenericPreviewError,
  GENERIC_AUDIO_LIMIT,
  GENERIC_HTML_LIMIT,
} from './generic-preview.mjs';
function wav() {
  const b = Buffer.alloc(46);
  b.write('RIFF');
  b.writeUInt32LE(38, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(2, 40);
  return b;
}
const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
function reply(bytes = wav(), type = 'audio/wav', statusCode = 200, headers = {}) {
  return {
    statusCode,
    headers: { 'content-type': type, ...headers },
    body: (async function* () {
      yield bytes;
    })(),
  };
}
const code = (status) => (error) => error instanceof GenericPreviewError && error.status === status;
test('all private, special, mapped and reserved IP families blocked', () => {
  for (const address of [
    '0.0.0.0',
    '10.2.3.4',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '168.63.129.16',
    '172.16.1.1',
    '172.31.255.255',
    '192.0.0.9',
    '192.0.2.1',
    '192.168.1.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '100::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2001::1',
    '2001:20::1',
    '2002:7f00:1::',
    '3fff::1',
    'fe80::1%lo0',
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of [
    '8.8.8.8',
    '93.184.216.34',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])
    assert.equal(isPublicAddress(address), true, address);
});
test('invalid schemes, embedded credentials, ports and auth queries never request', async () => {
  for (const url of [
    'http://example.com/a.wav',
    'file:///etc/passwd',
    'https://user:pass@example.com/a',
    'https://example.com:444/a',
    'https://example.com/a?token=secret',
    'https://example.com/a?X-Amz-Signature=secret',
    'https://example.com/a#x',
    'https://localhost/a',
    'https://metadata.google.internal/a',
    'https://example.com/%0afoo',
  ]) {
    let calls = 0;
    await assert.rejects(
      fetchGenericPreview(url, {
        resolve: publicDns,
        request: async () => {
          calls++;
          return reply();
        },
      }),
    );
    assert.equal(calls, 0, url);
  }
});
test('IP literal alternative encodings blocked before request', async () => {
  for (const url of [
    'https://2130706433/a',
    'https://0x7f000001/a',
    'https://127.1/a',
    'https://[::ffff:127.0.0.1]/a',
    'https://[::1]/a',
  ]) {
    let calls = 0;
    await assert.rejects(
      fetchGenericPreview(url, {
        resolve: publicDns,
        request: async () => {
          calls++;
          return reply();
        },
      }),
      code(403),
    );
    assert.equal(calls, 0);
  }
});
test('mixed DNS answers deny entire host, no public-first bypass', async () => {
  let calls = 0;
  await assert.rejects(
    fetchGenericPreview('https://example.com/a', {
      resolve: async () => [
        { address: '1.1.1.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      request: async () => {
        calls++;
        return reply();
      },
    }),
    code(403),
  );
  assert.equal(calls, 0);
});
test('verified IP pinned, original hostname retained, no secret/cookie/auth headers', async () => {
  let lookups = 0;
  const result = await fetchGenericPreview('https://example.com:443/a.wav', {
    resolve: async (host, options) => {
      lookups++;
      assert.equal(host, 'example.com');
      assert.equal(options.all, true);
      return publicDns();
    },
    request: async (url, options) => {
      assert.equal(url.hostname, 'example.com');
      assert.equal(options.address, '93.184.216.34');
      assert.equal(options.family, 4);
      assert.deepEqual(Object.keys(options.headers).sort(), [
        'Accept',
        'Accept-Encoding',
        'User-Agent',
      ]);
      assert.equal(options.headers['Accept-Encoding'], 'identity');
      assert.equal(options.signal.aborted, false);
      return reply();
    },
  });
  assert.equal(lookups, 1);
  assert.equal(result.contentType, 'audio/wav');
  assert.deepEqual(result.bytes, wav());
});
test('redirect, compression, huge length and huge chunk rejected without retry', async () => {
  for (const response of [
    reply(wav(), 'audio/wav', 302, { location: 'http://127.0.0.1' }),
    reply(wav(), 'audio/wav', 200, { 'content-encoding': 'gzip' }),
    reply(wav(), 'audio/wav', 200, { 'content-length': String(GENERIC_AUDIO_LIMIT + 1) }),
    reply(Buffer.alloc(GENERIC_AUDIO_LIMIT + 1)),
  ]) {
    let calls = 0;
    await assert.rejects(
      fetchGenericPreview('https://example.com/a', {
        resolve: publicDns,
        request: async () => {
          calls++;
          return response;
        },
      }),
    );
    assert.equal(calls, 1);
  }
});
test('HTML audio/source/meta extraction, entities, relative URL and bounded candidates', async () => {
  for (const html of [
    '<audio src="/sample.wav?x=1&amp;y=2"></audio>',
    '<audio><source src="/sample.wav"></audio>',
    '<meta property="og:audio" content="/sample.wav">',
    '<meta name="twitter:player:stream" content="/sample.wav">',
  ]) {
    const seen = [];
    const result = await fetchGenericPreview('https://example.com/page', {
      resolve: publicDns,
      request: async (url) => {
        seen.push(url.href);
        return seen.length === 1 ? reply(Buffer.from(html), 'text/html') : reply();
      },
    });
    assert.equal(seen.length, 2);
    assert(result.audioUrl.startsWith('https://example.com/sample.wav'));
  }
  let calls = 0;
  await assert.rejects(
    fetchGenericPreview('https://example.com/page', {
      resolve: publicDns,
      request: async () =>
        ++calls === 1
          ? reply(
              Buffer.from(
                '<audio src="/a"></audio><audio src="/b"></audio><audio src="/c"></audio>',
              ),
              'text/html',
            )
          : reply(Buffer.from('not audio')),
    }),
  );
  assert.equal(calls, 3);
});
test('no JS/template/video/iframe/base traversal, no page recursion, new host DNS checked', async () => {
  const html =
    '<script>"<audio src=\"https://example.com/a\">"</script><video><source src="/video.mp4"></video><iframe src="/a"></iframe><template><audio src="/a"></audio></template>';
  let calls = 0;
  await assert.rejects(
    fetchGenericPreview('https://example.com/page', {
      resolve: publicDns,
      request: async () => {
        calls++;
        return reply(Buffer.from(html), 'text/html');
      },
    }),
    code(422),
  );
  assert.equal(calls, 1);
  const hosts = [];
  calls = 0;
  await assert.rejects(
    fetchGenericPreview('https://example.com/page', {
      resolve: async (host) => {
        hosts.push(host);
        return host === 'private.example'
          ? [{ address: '169.254.169.254', family: 4 }]
          : publicDns();
      },
      request: async () => {
        calls++;
        return reply(
          Buffer.from(
            '<base href="http://127.0.0.1"><audio src="https://private.example/a"></audio>',
          ),
          'text/html',
        );
      },
    }),
    code(403),
  );
  assert.equal(calls, 1);
  assert.deepEqual(hosts, ['example.com', 'private.example']);
  await assert.rejects(
    fetchGenericPreview('https://example.com/page', {
      resolve: publicDns,
      request: async () => reply(Buffer.from('<audio src="/next"></audio>'), 'text/html'),
    }),
    code(422),
  );
});
test('HTML and actual byte caps, truncation and non-audio magic enforced', async () => {
  for (const response of [
    reply(Buffer.alloc(GENERIC_HTML_LIMIT + 1), 'text/html'),
    reply(wav(), 'audio/wav', 200, { 'content-length': '999' }),
    reply(Buffer.from('ID3 only')),
  ])
    await assert.rejects(
      fetchGenericPreview('https://example.com/a', {
        resolve: publicDns,
        request: async () => response,
      }),
    );
  assert.equal(detectAudioType(Buffer.from('OggS fake video')), null);
  assert.equal(detectAudioType(wav()), 'audio/wav');
  const mp3 = Buffer.alloc(834);
  mp3.set([255, 251, 144, 0]);
  mp3.set([255, 251, 144, 0], 417);
  assert.equal(detectAudioType(mp3), 'audio/mpeg');
  const ogg = Buffer.alloc(47);
  ogg.write('OggS');
  ogg[26] = 1;
  ogg[27] = 19;
  ogg.write('OpusHead', 28);
  assert.equal(detectAudioType(ogg), 'audio/ogg');
});
test('abort before DNS, during DNS and while reading propagates; raw errors sanitized', async () => {
  const c = new AbortController();
  c.abort();
  let calls = 0;
  await assert.rejects(
    fetchGenericPreview('https://example.com/a', {
      signal: c.signal,
      resolve: async () => {
        calls++;
        return publicDns();
      },
    }),
    (e) => e.name === 'AbortError',
  );
  assert.equal(calls, 0);
  const c2 = new AbortController();
  const p = fetchGenericPreview('https://example.com/a', {
    signal: c2.signal,
    resolve: () => new Promise(() => {}),
    request: async () => {
      calls++;
      return reply();
    },
  });
  c2.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.equal(calls, 0);
  const c3 = new AbortController();
  let notify;
  const entered = new Promise((r) => (notify = r));
  const p3 = fetchGenericPreview('https://example.com/a', {
    signal: c3.signal,
    resolve: publicDns,
    request: async () => ({
      statusCode: 200,
      headers: {},
      body: {
        [Symbol.asyncIterator]() {
          return {
            next() {
              notify();
              return new Promise(() => {});
            },
          };
        },
      },
    }),
  });
  await entered;
  c3.abort();
  await assert.rejects(p3, (e) => e.name === 'AbortError');
  await assert.rejects(
    fetchGenericPreview('https://example.com/a', {
      resolve: async () => {
        throw new Error('secret internal resolver detail');
      },
    }),
    (e) => e.status === 502 && !e.message.includes('secret'),
  );
});
test('fake-only desktop DNS resolves via fixed-resolver hook and pins public result', async () => {
  let doh = 0;
  const r = await fetchGenericPreview('https://wiki.leagueoflegends.com/audio.wav', {
    resolve: async () => [
      { address: '198.18.2.51', family: 4 },
      { address: '198.19.1.2', family: 4 },
    ],
    dohResolve: async (host, { signal }) => {
      doh++;
      assert.equal(host, 'wiki.leagueoflegends.com');
      assert.equal(signal.aborted, false);
      return [{ address: '104.26.0.173', family: 4 }];
    },
    request: async (url, options) => {
      assert.equal(options.address, '104.26.0.173');
      assert.equal(url.hostname, 'wiki.leagueoflegends.com');
      return reply();
    },
  });
  assert.equal(doh, 1);
  assert.equal(r.contentType, 'audio/wav');
});
test('DoH never bypasses mixed/private DNS and never receives internal/reserved names', async () => {
  for (const answers of [
    [{ address: '127.0.0.1', family: 4 }],
    [
      { address: '198.18.1.1', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ],
    [
      { address: '198.18.1.1', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ],
  ]) {
    let doh = 0;
    await assert.rejects(
      fetchGenericPreview('https://wiki.leagueoflegends.com/a', {
        resolve: async () => answers,
        dohResolve: async () => {
          doh++;
          return publicDns();
        },
        request: async () => assert.fail('must not request'),
      }),
      code(403),
    );
    assert.equal(doh, 0);
  }
  for (const host of [
    'test.internal',
    'test.local',
    'test.arpa',
    'test.test',
    'test.invalid',
    'test.onion',
    'test.corp',
  ]) {
    let doh = 0;
    await assert.rejects(
      fetchGenericPreview('https://' + host + '/a', {
        resolve: async () => [{ address: '198.18.1.1', family: 4 }],
        dohResolve: async () => {
          doh++;
          return publicDns();
        },
        request: async () => assert.fail('must not request'),
      }),
    );
    assert.equal(doh, 0);
  }
});
test('private or mixed public DoH result rejected, including empty and malformed answers', async () => {
  for (const answers of [
    [],
    [{ address: '127.0.0.1', family: 4 }],
    [
      { address: '1.1.1.1', family: 4 },
      { address: '::ffff:169.254.169.254', family: 6 },
    ],
    [{ address: '1.1.1.1', family: 6 }],
  ])
    await assert.rejects(
      fetchGenericPreview('https://wiki.leagueoflegends.com/a', {
        resolve: async () => [{ address: '198.18.1.1', family: 4 }],
        dohResolve: async () => answers,
        request: async () => assert.fail('must not request'),
      }),
      code(403),
    );
});
test('HTML stops on complete early candidate, closes stream and reuses same-host pin per job', async () => {
  let lookups = 0,
    reads = 0,
    destroyed = 0,
    requests = 0;
  const html = Buffer.from('<audio><source src="/early.wav"></audio>' + ' '.repeat(16384));
  const run = () =>
    fetchGenericPreview('https://example.com/page', {
      resolve: async () => {
        lookups++;
        return publicDns();
      },
      request: async (url, options) => {
        requests++;
        assert.equal(options.address, '93.184.216.34');
        if (url.pathname !== '/page') return reply();
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/html', 'content-length': '2000000' },
          body: {
            destroy() {
              destroyed++;
            },
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  reads++;
                  if (reads % 2 === 0) throw new Error('must not read remainder');
                  return { value: html, done: false };
                },
              };
            },
          },
        };
      },
    });
  const result = await run();
  assert.equal(result.audioUrl, 'https://example.com/early.wav');
  assert.equal(lookups, 1);
  assert.equal(reads, 1);
  assert.equal(destroyed, 1);
  assert.equal(requests, 2);
  // Fresh invocation must not reuse a previous job's resolution.
  reads = 0;
  await run();
  assert.equal(lookups, 2);
});
test('HTML prefix does not accept unfinished source or script, and audio is never prefix-truncated', async () => {
  for (const prefix of [
    '<audio>' + ' '.repeat(16384) + '<source src="/wrong.wav"',
    '<script>' + ' '.repeat(16384) + '<audio src="/wrong.wav">',
    '<!--' + ' '.repeat(16384) + '<audio src="/wrong.wav">',
  ]) {
    let reads = 0;
    await assert.rejects(
      fetchGenericPreview('https://example.com/page', {
        resolve: publicDns,
        request: async () => ({
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  reads++;
                  return reads === 1 ? { value: Buffer.from(prefix), done: false } : { done: true };
                },
              };
            },
          },
        }),
      }),
      code(422),
    );
    assert.equal(reads, 2);
  }
  let reads = 0;
  const bytes = wav();
  const result = await fetchGenericPreview('https://example.com/audio', {
    resolve: publicDns,
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'audio/wav', 'content-length': String(bytes.length) },
      body: (async function* () {
        reads++;
        yield bytes.subarray(0, 24);
        reads++;
        yield bytes.subarray(24);
      })(),
    }),
  });
  assert.equal(reads, 2);
  assert.deepEqual(result.bytes, bytes);
});
