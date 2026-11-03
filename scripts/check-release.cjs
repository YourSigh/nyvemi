// Inspect the shipped APK, including compressed and hashed/renamed entries.
// Never print credential values or matching bundle contents.
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const { parseEnv } = require('node:util');
const { unzipSync } = require('fflate');
const root = path.dirname(require.resolve('../package.json'));
const apk = process.argv[2];
if (!apk) throw Error('Usage: node scripts/check-release.cjs <standalone.apk>');
const entries = unzipSync(fs.readFileSync(apk));
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
console.log(`SHA256 ${digest(fs.readFileSync(apk))}`);
