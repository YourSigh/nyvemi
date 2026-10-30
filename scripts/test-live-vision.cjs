const { readFileSync, existsSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const local = {};
for (const file of ['.env.local', '.env'])
  if (existsSync(file))
    for (const [k, v] of Object.entries(parseEnv(readFileSync(file, 'utf8'))))
      if (v.trim()) local[k] = v.trim();
if (local.NYVEMI_VISION_ENABLE_LIVE_TESTS !== '1') {
  console.error('未开启收费识图测试；需要显式设置 NYVEMI_VISION_ENABLE_LIVE_TESTS=1。');
  process.exit(2);
}
const key = local.NYVEMI_VISION_API_KEY || local.NYVEMI_ARK_API_KEY;
const base = local.NYVEMI_VISION_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
if (!key || new URL(base).origin !== 'https://ark.cn-beijing.volces.com') {
  console.error('本测试需要豆包Key，且仅向火山方舟官方接口发送。');
  process.exit(2);
}
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/live-vision.test.ts'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NYVEMI_RUN_LIVE_VISION: '1',
      NYVEMI_VISION_API_KEY: key,
      NYVEMI_VISION_BASE_URL: base,
      NYVEMI_VISION_MODEL: local.NYVEMI_VISION_MODEL || 'doubao-seed-2-1-pro-260915',
    },
  },
);
process.exit(result.status ?? 1);
