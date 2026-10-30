import { createAlsRuntime } from '../../vendor/deepseek-harness/packages/experimental/webworker-runtime/src/polyfill/async-context/als-runtime.ts';
import {
  __snapshotAll,
  __restoreAll,
} from '../../vendor/deepseek-harness/packages/experimental/webworker-runtime/src/node/builtin_modules/implemented/async_hooks.ts';
export const __als = createAlsRuntime({ snapshot: __snapshotAll, restore: __restoreAll });

export { mobileClone, MobileTextEncoder } from './compat.mjs';
