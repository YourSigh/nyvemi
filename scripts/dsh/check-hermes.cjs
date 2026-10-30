const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const babel = require('@babel/core');
const preset = require.resolve('babel-preset-expo', {
  paths: [require.resolve('expo/package.json')],
});
fs.mkdirSync('artifacts', { recursive: true });
const result = babel.transformFileSync('vendor/dsh-runtime/index.js', {
  presets: [preset],
  configFile: false,
  babelrc: false,
  caller: { name: 'metro', platform: 'android', isDev: false, engine: 'hermes' },
});
fs.writeFileSync('artifacts/dsh-metro.js', result.code);
const os = process.platform === 'darwin' ? 'osx-bin' : 'linux64-bin';
execFileSync(
  path.join('node_modules/hermes-compiler/hermesc', os, 'hermesc'),
  ['-w', '-emit-binary', '-out', 'artifacts/dsh-core.hbc', 'artifacts/dsh-metro.js'],
  { stdio: 'inherit' },
);
console.log('Embedded DSH: Expo transform and Hermes bytecode compilation passed.');
