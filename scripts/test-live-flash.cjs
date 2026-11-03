const { readFileSync, existsSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
if (!process.argv.includes('--allow-flash-split')) {
  console.error('请显式传入 --allow-flash-split；本任务最多2次Flash拆层请求，不重新生图。');
  process.exit(2);
}
const local = {};
for (const file of ['.env.local', '.env'])
  if (existsSync(file))
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8'))))
      if (value.trim()) local[key] = value.trim();
if (!local.NYVEMI_ARK_API_KEY || !(local.NYVEMI_TEST_API_KEY || local.DEEPSEEK_API_KEY)) {
  console.error('请配置现有豆包和DeepSeek测试密钥；不会打印密钥。');
  process.exit(2);
}
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/live-flash-split.test.ts'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_NO_DOTENV: '1',
      NYVEMI_RUN_LIVE_FLASH_SPLIT: '1',
      NYVEMI_FLASH_REFINED: process.argv.includes('--refined') ? '1' : '0',
      NYVEMI_ARK_API_KEY: local.NYVEMI_ARK_API_KEY,
      NYVEMI_TEST_API_KEY: local.NYVEMI_TEST_API_KEY || local.DEEPSEEK_API_KEY,
      NYVEMI_TEST_MODEL: local.NYVEMI_TEST_MODEL || 'deepseek-flash',
    },
  },
);
process.exit(result.status ?? 1);
