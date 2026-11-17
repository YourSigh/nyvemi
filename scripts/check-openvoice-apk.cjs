// Verify the shipped, download-on-demand ARM64 OpenVoice release. Never reads credentials.
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
function requireCheck(ok, message) {
  if (!ok) throw new Error(message);
}
async function readEntry(apk, entry, limit) {
  const child = spawn('unzip', ['-p', apk, entry], { stdio: ['ignore', 'pipe', 'pipe'] });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Cannot extract ${entry}`)),
    );
  });
  completion.catch(() => {});
  child.stderr.resume();
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of child.stdout) {
      size += chunk.length;
      if (size > limit) {
        child.kill();
        throw new Error(`Oversized APK entry: ${entry}`);
      }
      chunks.push(chunk);
    }
    await completion;
    return Buffer.concat(chunks, size);
  } catch (error) {
    child.kill();
    await completion.catch(() => {});
    throw error;
  }
}
async function verify(apk) {
  apk = path.resolve(apk);
  const size = fs.statSync(apk).size;
  requireCheck(size > 0 && size < 200000000, 'APK must be strictly under 200,000,000 bytes');
  const names = execFileSync('unzip', ['-Z1', apk], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
    .trimEnd()
    .split('\n');
  requireCheck(new Set(names).size === names.length, 'APK contains duplicate ZIP entry names');
  requireCheck(
    !names.some((name) => /\.(?:onnx|onnx_data|zip)$/i.test(name) && name.startsWith('assets/')),
    'APK must not bundle model graphs or model archives',
  );
  requireCheck(
    names.includes('assets/index.android.bundle'),
    'APK lacks its standalone JavaScript bundle',
  );
  const abis = new Set();
  for (const name of names) {
    requireCheck(
      !name.split('/').includes('..') && !name.startsWith('/'),
      'APK contains an unsafe entry path',
    );
    const native = /^lib\/([^/]+)\//.exec(name);
    if (native) abis.add(native[1]);
    requireCheck(
      !/^assets\/qwen\//i.test(name) || name === 'assets/qwen/LICENSE.txt',
      'APK must not bundle Qwen model assets',
    );
    requireCheck(!/\.(?:pcm|wav)$/i.test(name), 'APK must not bundle test or reference audio');
    requireCheck(
      !/(?:qa[-_]?fixture|nyvemi[-_]qa|synthetic[-_]?reference|test[-_]?reference|voice[-_]?fixture)/i.test(
        name,
      ),
      'APK contains a QA/reference fixture',
    );
    if (name.startsWith('assets/openvoice/') && !name.endsWith('/'))
      requireCheck(/\.(?:txt|md)$/i.test(name), 'APK must not include OpenVoice model assets');
  }
  requireCheck(
    abis.size === 1 && abis.has('arm64-v8a'),
    'APK must contain only arm64-v8a native libraries',
  );
  requireCheck(
    names.includes('lib/arm64-v8a/libonnxruntime.so') &&
      names.includes('lib/arm64-v8a/libonnxruntime4j_jni.so'),
    'APK lacks native ONNX Runtime libraries',
  );
  const bundle = await readEntry(apk, 'assets/index.android.bundle', 64 * 1024 * 1024);
  requireCheck(
    !/(?:nyvemi-qa-20261117|nyvemi-qa-stella|nyvemi-qa-tide|NYVEMI_QA_FIXTURE|QAfixture)/i.test(
      bundle.toString('latin1'),
    ),
    'APK JavaScript contains a QA fixture marker',
  );
  console.log(
    `PASS APK: ${size} bytes (${(size / 1048576).toFixed(2)} MiB), ARM64 only, standalone JS and ONNX Runtime present, no Qwen models or WAV/PCM/QA fixture assets`,
  );
}
if (require.main === module)
  verify(process.argv[2] || 'android/app/build/outputs/apk/release/app-release.apk').catch(
    (error) => {
      console.error(`FAIL: ${error.message}`);
      process.exitCode = 1;
    },
  );
module.exports = { verify };
