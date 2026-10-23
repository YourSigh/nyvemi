const { readFileSync, existsSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const local = {};
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (value.trim()) local[key] = value.trim();
  }
}
const key = local.NYVEMI_TEST_API_KEY || local.DEEPSEEK_API_KEY;
if (!key) {
  console.error('请在 .env 或 .env.local 填写 NYVEMI_TEST_API_KEY（也支持 DEEPSEEK_API_KEY）。');
  process.exit(2);
}
const base = local.NYVEMI_TEST_BASE_URL || 'https://api.deepseek.com';
if (new URL(base).origin !== 'https://api.deepseek.com') {
  console.error('本测试只将 DeepSeek Key 发给 https://api.deepseek.com。请检查地址。');
  process.exit(2);
}
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/live-provider.test.ts'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NYVEMI_RUN_LIVE: '1',
      NYVEMI_LIVE_FOCUS: process.argv.includes('--focus-memory') ? 'memory' : 'full',
      NYVEMI_TEST_API_KEY: key,
      NYVEMI_TEST_BASE_URL: base,
      NYVEMI_TEST_MODEL: local.NYVEMI_TEST_MODEL || 'deepseek-flash',
    },
  },
);
process.exit(result.status ?? 1);
