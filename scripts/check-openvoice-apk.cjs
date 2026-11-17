// Verify the shipped, bundled-only ARM64 OpenVoice release. Never reads credentials.
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { unzipSync } = require('fflate');
const ASSET = 'assets/openvoice/openvoice-v2-android-1.zip';
const PACK_BYTES = 122874105;
const PACK_SHA = '9f6d7822c57371227e70803481c7c8cddcbbc5848f0d9e8234bbe941f3bb64e6';
const CONTENTS = {
  'tone_encoder.onnx': [
    3257655,
    '64bd5e39bc92b1265e35eeb73e9e30558de6c54f15c176bff6f9b7543a0a2c91',
  ],
  'tone_converter.onnx': [
    128052947,
    '19ced6f4232d212e21ebd8562bd10eae7b5731610587dcdb691c1cedcf2f7507',
  ],
  'OPENVOICE-LICENSE.txt': [
    1057,
    'bb3541f421e6273d3a3e3dd5bdba2bd3b79a3c2eadca65cde9c62c2467903ac0',
  ],
  'MODEL-NOTICE.txt': [1024, '2db6762a90c62bdd743686ba75416eaac317c98c0882015751a1986836adb229'],
};
const digest = (data) => createHash('sha256').update(data).digest('hex');
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
  requireCheck(names.includes(ASSET), 'APK lacks the exact bundled OpenVoice asset');
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
      requireCheck(name === ASSET, 'Unexpected OpenVoice APK asset');
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
  const pack = await readEntry(apk, ASSET, PACK_BYTES);
  requireCheck(pack.length === PACK_BYTES, 'Bundled model archive byte count mismatch');
  requireCheck(digest(pack) === PACK_SHA, 'Bundled model archive SHA-256 mismatch');
  const seen = new Set();
  const entries = unzipSync(pack, {
    filter(entry) {
      requireCheck(
        Object.hasOwn(CONTENTS, entry.name),
        'Unexpected entry in bundled model archive',
      );
      requireCheck(!seen.has(entry.name), 'Duplicate entry in bundled model archive');
      seen.add(entry.name);
      requireCheck(
        entry.originalSize === CONTENTS[entry.name][0],
        `Wrong uncompressed size: ${entry.name}`,
      );
      requireCheck(
        entry.compression === 0 || entry.compression === 8,
        'Unsupported inner archive compression',
      );
      return true;
    },
  });
  requireCheck(
    seen.size === Object.keys(CONTENTS).length,
    'Bundled model archive is missing required entries',
  );
  for (const [name, [bytes, sha]] of Object.entries(CONTENTS)) {
    requireCheck(
      entries[name]?.length === bytes && digest(entries[name]) === sha,
      `Bundled file hash mismatch: ${name}`,
    );
    console.log(`PASS ${name}: ${bytes} bytes SHA256 ${sha}`);
  }
  console.log(
    `PASS bundled model: ${PACK_BYTES} bytes (${(PACK_BYTES / 1048576).toFixed(2)} MiB) SHA256 ${PACK_SHA}`,
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
