const { Buffer } = require('node:buffer');
// Node-only build-time artwork tool. Never imported by the Android app.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const root = path.resolve(process.env.NYVEMI_AVATAR_WORK || 'artifacts/vtuber');
fs.mkdirSync(root, { recursive: true });
const env = {};
for (const file of ['.env.local', '.env'])
  if (fs.existsSync(file)) Object.assign(env, parseEnv(fs.readFileSync(file, 'utf8')));
const base = env.NYVEMI_ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const b64 = (file) =>
  `data:image/${fs.readFileSync(file)[0] === 137 ? 'png' : 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`;
async function request(operation, body) {
  const key = hash(JSON.stringify(body)),
    receipt = path.join(root, `${operation}-${key}.json`);
  if (fs.existsSync(receipt)) {
    const r = JSON.parse(fs.readFileSync(receipt));
    if (r.status === 'received') return r.response;
    throw Error('Previous request uncertain; inspect Ark before retrying.');
  }
  if (env.NYVEMI_ARK_ENABLE_LIVE_TESTS !== '1' || !env.NYVEMI_ARK_API_KEY)
    throw Error('Real artwork calls disabled');
  if (new URL(base).origin !== 'https://ark.cn-beijing.volces.com')
    throw Error('This test sends keys only to official Ark');
  const budgetFile = path.join(root, 'budget.json'),
    budget = fs.existsSync(budgetFile) ? JSON.parse(fs.readFileSync(budgetFile)) : { requests: 0 };
  const limit = Math.max(1, Math.min(7, Number(process.env.NYVEMI_AVATAR_REQUEST_LIMIT) || 7));
  if (budget.requests >= limit) throw Error('Artwork batch request limit reached');
  budget.requests++;
  fs.writeFileSync(budgetFile, JSON.stringify({ ...budget, limit }));
  fs.writeFileSync(receipt, JSON.stringify({ status: 'started', operation, model: body.model }));
  const response = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.NYVEMI_ARK_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240000),
  });
  const json = await response.json();
  if (!response.ok) {
    fs.writeFileSync(
      receipt,
      JSON.stringify({ status: 'failed', httpStatus: response.status, code: json.error?.code }),
    );
    throw Error(`Ark HTTP ${response.status}: ${json.error?.code || 'request_failed'}`);
  }
  fs.writeFileSync(receipt, JSON.stringify({ status: 'received', operation, response: json }));
  return json;
}
async function download(item, file) {
  const identity = hash(item.url),
    origin = `${file}.origin`;
  if (fs.existsSync(file) && fs.existsSync(origin) && fs.readFileSync(origin, 'utf8') === identity)
    return file;
  if (new URL(item.url).protocol !== 'https:') throw Error('Output image must use HTTPS');
  const response = await fetch(item.url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw Error(`Download failed ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw Error('Image exceeds limit');
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(origin, identity);
  return file;
}
module.exports = { root, env, b64, hash, request, download };
