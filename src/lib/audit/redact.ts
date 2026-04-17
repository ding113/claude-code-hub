const DEFAULT_SENSITIVE_KEYS = new Set([
  "key",
  "apikey",
  "api_key",
  "password",
  "secret",
  "token",
  "authorization",
  "webhook_secret",
  "webhookSecret",
]);

const REDACTED = "[REDACTED]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-copy `value` with fields matching the sensitive key set replaced by
 * `[REDACTED]`. Non-mutating. Used to sanitize before/after snapshots before
 * they hit the audit log (which is eventually viewable by operators).
 */
export function redactSensitive<T>(value: T, extraKeys: string[] = []): T {
  const keys = new Set([...DEFAULT_SENSITIVE_KEYS, ...extraKeys.map((k) => k.toLowerCase())]);
  return walk(value, keys) as T;
}

function walk(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, keys));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (keys.has(k.toLowerCase())) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = walk(v, keys);
    }
    return out;
  }
  return value;
}
