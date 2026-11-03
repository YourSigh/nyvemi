const { readFileSync, existsSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
if (!process.argv.includes('--allow-one-image')) {
  console.error('需要显式传入 --allow-one-image；此脚本最多发起一次生图请求，不拆层。');
  process.exit(2);
}
const budgetFile = 'artifacts/live-reference-generation/budget.json';
if (existsSync(budgetFile)) {
  const budget = JSON.parse(readFileSync(budgetFile, 'utf8'));
  if (!Number.isInteger(budget.requests) || budget.requests < 0) {
    console.error('请求额度记录无效，停止测试；不会发起请求。');
    process.exit(2);
  }
  if (budget.requests >= 1) {
    const reportFile = 'artifacts/live-reference-generation/result.json';
    const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : {};
    if (!report.output) {
      console.error('本次授权的1次请求已用完，且没有已生成图片可核对。保留原失败记录，不会重发。');
      process.exit(2);
    }
  }
}
const local = {};
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, 'utf8'))))
    if (value.trim()) local[name] = value.trim();
}
const chatKey = local.NYVEMI_TEST_API_KEY || local.DEEPSEEK_API_KEY;
if (!local.NYVEMI_ARK_API_KEY || !chatKey) {
  console.error('本次测试需要已配置的豆包和DeepSeek密钥；不会打印密钥。');
  process.exit(2);
}
const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/live-reference-generation.test.ts'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_NO_DOTENV: '1',
      NYVEMI_RUN_LIVE_REFERENCE_GENERATION: '1',
      NYVEMI_ARK_API_KEY: local.NYVEMI_ARK_API_KEY,
      NYVEMI_TEST_API_KEY: chatKey,
      NYVEMI_TEST_MODEL: local.NYVEMI_TEST_MODEL || 'deepseek-flash',
    },
  },
);
process.exit(result.status ?? 1);
