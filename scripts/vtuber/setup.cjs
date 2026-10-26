const fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
const revision = '692986728e2b7b9254a41a22bdce1656bc0c12f9',
  dir = path.resolve(process.env.PSD2LIVE_HOME || 'artifacts/psd2live');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync('git', ['clone', 'https://github.com/tsunehimatoi/psd2live.git', dir], {
    stdio: 'inherit',
  });
  execFileSync('git', ['checkout', revision], { cwd: dir, stdio: 'inherit' });
}
const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
if (actual !== revision)
  throw Error('Compiler revision differs; use a separate checkout at the pinned revision');
console.log(`Pinned compiler ready at ${dir}`);
