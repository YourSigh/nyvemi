import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import type { AgentRunner } from '../src/agent/core';
const require = createRequire(import.meta.url);
export function mobileAgentRunner() {
  const { AbortController, AbortSignal } = require('abort-controller/dist/abort-controller');
  const module = { exports: {} as { run: AgentRunner } };
  const context = createContext({
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    URL,
    AbortController,
    AbortSignal,
    crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
  });
  // No Node process/require/TextEncoder, native AbortSignal helpers or Promise.withResolvers.
  runInContext('Promise.withResolvers = undefined; Array.prototype.findLast = undefined;', context);
  runInContext(readFileSync('vendor/dsh-runtime/index.js', 'utf8'), context);
  return module.exports.run;
}
