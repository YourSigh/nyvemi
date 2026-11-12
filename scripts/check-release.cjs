// Inspect the shipped APK, including compressed and hashed/renamed entries.
// Never print credential values or matching bundle contents.
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { parseEnv } = require('node:util');
const { unzipSync } = require('fflate');
const root = path.dirname(require.resolve('../package.json'));
const apk = process.argv[2];
if (!apk) throw Error('Usage: node scripts/check-release.cjs <standalone.apk>');
const modelName = 'assets/qwen/customvoice.gguf';
let modelIncluded = false;
const entries = unzipSync(fs.readFileSync(apk), {
  filter(entry) {
    if (entry.name !== modelName) return true;
    if (entry.compression !== 0 || entry.originalSize !== 760680704)
      throw Error('Qwen voice pack must be stored uncompressed in the APK');
    modelIncluded = true;
    return false;
  },
});
if (!entries['assets/index.android.bundle']) throw Error('APK is missing its embedded JavaScript');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reference = path.join(root, 'dev-assets/characters');
const forbiddenAssets = new Set(
  fs.readdirSync(reference).map((name) => digest(fs.readFileSync(path.join(reference, name)))),
);
const credentials = new Set();
for (const name of ['.env', '.env.local']) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (/(?:KEY|SECRET|TOKEN)/i.test(key) && value.length > 8) credentials.add(value);
  }
}
const characterMarkers = ['桶砸', 'tongza', '\\u6876\\u7838'];
for (const [name, bytes] of Object.entries(entries)) {
  const buffer = Buffer.from(bytes);
  if (/dev-assets|tongza/i.test(name) || forbiddenAssets.has(digest(bytes)))
    throw Error('APK contains developer-only character artwork');
  for (const marker of characterMarkers) {
    if (buffer.includes(Buffer.from(marker)) || buffer.includes(Buffer.from(marker, 'utf16le')))
      throw Error('APK contains a removed character marker');
  }
  for (const value of credentials) {
    if (buffer.includes(Buffer.from(value)) || buffer.includes(Buffer.from(value, 'utf16le')))
      throw Error('APK contains a local development credential');
  }
}
console.log(
  'PASS: standalone JS present; no developer character assets, preset markers or local credentials.',
);
async function hashStream(stream) {
  const hash = createHash('sha256');
  for await (const bytes of stream) hash.update(bytes);
  return hash.digest('hex');
}

async function verifyLargeAssets() {
  if (modelIncluded) {
    const unzip = spawn('unzip', ['-p', path.resolve(apk), modelName], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const finished = new Promise((resolve, reject) => {
      unzip.on('error', reject);
      unzip.on('close', (code) =>
        code === 0 ? resolve() : reject(Error('Could not read the bundled voice pack')),
      );
    });
    const [hash] = await Promise.all([hashStream(unzip.stdout), finished]);
    if (hash !== '67cbe04239d079d3e3649a054258b8cf1553a99a03cc5b38d57350c6905e4cbd')
      throw Error('Unexpected Qwen voice pack checksum');
    if (!entries['lib/arm64-v8a/libnyvemi_qwen.so']) throw Error('APK is missing the Qwen engine');
    console.log('PASS: bundled Qwen voice pack and ARM64 engine verified.');
  }
  console.log(`SHA256 ${await hashStream(fs.createReadStream(apk))}`);
}
verifyLargeAssets().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
