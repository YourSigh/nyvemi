const { readFileSync, existsSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const local = {};
for (const file of ['.env.local', '.env'])
  if (existsSync(file)) Object.assign(local, parseEnv(readFileSync(file, 'utf8')));
if (local.NYVEMI_ARK_ENABLE_LIVE_TESTS !== '1' || !local.NYVEMI_ARK_API_KEY?.trim()) {
  console.error(
    '未开启真实生图测试；请填写 NYVEMI_ARK_API_KEY，并显式设置 NYVEMI_ARK_ENABLE_LIVE_TESTS=1。',
  );
  process.exit(2);
}
if (new URL(local.NYVEMI_ARK_BASE_URL).origin !== 'https://ark.cn-beijing.volces.com') {
  console.error('此测试仅向火山方舟官方接口发送密钥。');
  process.exit(2);
}
const selected = Object.fromEntries(
  Object.entries(local).filter(([k]) => k.startsWith('NYVEMI_ARK_')),
);
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/live-images.test.ts'],
  {
    stdio: 'inherit',
    env: { ...process.env, ...selected, EXPO_NO_DOTENV: '1', NYVEMI_RUN_LIVE_IMAGES: '1' },
  },
);
process.exit(result.status ?? 1);
