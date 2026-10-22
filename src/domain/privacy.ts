/** Redact a configured credential from JSON data without corrupting JSON syntax. */
export function redactKnownSecret(value: unknown, secret?: string): unknown {
  if (!secret || secret === 'local') return value;
  if (typeof value === 'string') return value.split(secret).join('[REDACTED]');
  if (Array.isArray(value)) return value.map((item) => redactKnownSecret(item, secret));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactKnownSecret(item, secret)]),
    );
  }
  return value;
}
