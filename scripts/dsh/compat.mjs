import { Buffer } from 'buffer';
export const MobileTextEncoder =
  globalThis.TextEncoder ??
  class TextEncoder {
    encode(text = '') {
      return Uint8Array.from(Buffer.from(text, 'utf8'));
    }
  };
// Spec-compatible additions missing from Hermes. No Node process or network shim.
if (!Symbol.dispose) Object.defineProperty(Symbol, 'dispose', { value: Symbol('Symbol.dispose') });
if (!Symbol.asyncDispose)
  Object.defineProperty(Symbol, 'asyncDispose', { value: Symbol('Symbol.asyncDispose') });
if (!Promise.withResolvers)
  Promise.withResolvers = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  };
if (!Array.prototype.toSpliced)
  Object.defineProperty(Array.prototype, 'toSpliced', {
    value: function (...args) {
      const result = this.slice();
      result.splice(...args);
      return result;
    },
  });
if (!Array.prototype.toReversed)
  Object.defineProperty(Array.prototype, 'toReversed', {
    value: function () {
      return this.slice().reverse();
    },
  });
if (!AbortSignal.prototype.throwIfAborted)
  AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) throw this.reason ?? new Error('Aborted');
  };
if (!AbortSignal.any)
  AbortSignal.any = (signals) => {
    const controller = new AbortController(),
      subscriptions = [];
    const abort = (signal) => {
      controller.abort(signal.reason);
      for (const [source, listener] of subscriptions) source.removeEventListener('abort', listener);
    };
    for (const signal of signals) {
      if (signal.aborted) {
        abort(signal);
        break;
      }
      const listener = () => abort(signal);
      subscriptions.push([signal, listener]);
      signal.addEventListener('abort', listener, { once: true });
    }
    return controller.signal;
  };
export function mobileClone(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol')
      throw new Error('Value cannot be cloned');
    return value;
  }
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value);
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value))
    return value instanceof DataView
      ? new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
      : new value.constructor(value);
  const result =
    value instanceof Map
      ? new Map()
      : value instanceof Set
        ? new Set()
        : Array.isArray(value)
          ? []
          : {};
  seen.set(value, result);
  if (value instanceof Map)
    for (const [key, item] of value) result.set(mobileClone(key, seen), mobileClone(item, seen));
  else if (value instanceof Set) for (const item of value) result.add(mobileClone(item, seen));
  else
    for (const key of Object.keys(value))
      Object.defineProperty(result, key, {
        value: mobileClone(value[key], seen),
        enumerable: true,
        writable: true,
        configurable: true,
      });
  return result;
}

if (!Array.prototype.findLast)
  Object.defineProperty(Array.prototype, 'findLast', {
    value: function (fn) {
      for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return this[i];
    },
  });
