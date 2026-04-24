// Lowercase-only — the walker compares against `k.toLowerCase()`, so any
// mixed-case entry here would silently never match. Covers the common
// camelCase / snake_case / kebab-case variants of each secret surface.
const DEFAULT_SENSITIVE_KEYS = new Set([
  "key",
  "apikey",
  "api_key",
  "api-key",
  "password",
  "secret",
  "token",
  "authorization",
  "webhook_secret",
  "webhooksecret",
  "webhook-secret",
]);

const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";

/**
 * True only for `{}` / `Object.create(null)` — rejects `Date`, `Map`, `Set`,
 * `Buffer`, `URL`, and user-defined classes. If we recursed into those via
 * `Object.entries`, we'd rewrite them to plain objects in the snapshot,
 * losing information the reviewer might need.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/**
 * Deep-copy `value` with fields matching the sensitive key set replaced by
 * `[REDACTED]`. Non-mutating. Used to sanitize before/after snapshots before
 * they hit the audit log (which is eventually viewable by operators).
 *
 * Non-POJO objects (Date, class instances, Buffers, etc.) pass through
 * untouched so the audit row preserves their `toJSON()` behavior at the
 * outer `JSON.stringify` step.
 */
export function redactSensitive<T>(value: T, extraKeys: string[] = []): T {
  const keys = new Set([...DEFAULT_SENSITIVE_KEYS, ...extraKeys.map((k) => k.toLowerCase())]);
  return walk(value, keys, new WeakSet<object>()) as T;
}

function walk(value: unknown, keys: Set<string>, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    return value.map((item) => walk(item, keys, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return CIRCULAR;
    // 中文说明：审计快照必须可序列化，循环引用直接替换成稳定占位符。
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (keys.has(k.toLowerCase())) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = walk(v, keys, seen);
    }
    return out;
  }
  return value;
}
