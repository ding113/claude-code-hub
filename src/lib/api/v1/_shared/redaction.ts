/**
 * /api/v1 敏感字段脱敏工具
 *
 * 设计要点：
 * - 仅在「日志 / 错误信封 / 调试输出」等场景使用，不能影响业务返回；
 * - 默认 keys 集合较保守（密码 / token / authorization / apiKey / key / secret），
 *   webhook URL / 第三方机器人 token 不在默认集合，只有调用方显式启用时才屏蔽；
 * - 不修改原对象，返回新结构（深拷贝时仅替换字符串值，避免误伤 Date/Buffer 等）。
 */

const REDACTED_PLACEHOLDER = "[REDACTED]";

/**
 * 默认脱敏字段：所有 v1 日志默认会屏蔽这些字段。
 *
 * 注意：故意不包含 webhookUrl / telegramBotToken / dingtalkSecret 等
 * 「域内敏感但调用方需要看到」的字段。需要这些字段也脱敏时，请显式
 * 使用 WEBHOOK_SECRET_KEYS。
 */
export const DEFAULT_SECRET_KEYS: ReadonlyArray<string> = [
  "apiKey",
  "key",
  "password",
  "token",
  "authorization",
  "secret",
];

/**
 * Webhook 相关的敏感字段集合（在 DEFAULT 之上扩展）。
 *
 * 适用于审计写入 webhook 配置 / 通知相关 payload 的场景。
 */
export const WEBHOOK_SECRET_KEYS: ReadonlyArray<string> = [
  ...DEFAULT_SECRET_KEYS,
  "webhookUrl",
  "telegramBotToken",
  "dingtalkSecret",
];

function buildLowerCaseKeySet(keys: ReadonlyArray<string>): Set<string> {
  const set = new Set<string>();
  for (const key of keys) {
    if (typeof key === "string" && key.length > 0) {
      set.add(key.toLowerCase());
    }
  }
  return set;
}

function redactValue(value: unknown, keySet: Set<string>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, keySet));
  }

  if (typeof value === "object") {
    // 仅处理朴素对象（包括 Record）；Date / Buffer / Map / Set 等保持原值。
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return redactObject(value as Record<string, unknown>, keySet);
    }
    return value;
  }

  return value;
}

function redactObject(obj: Record<string, unknown>, keySet: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (keySet.has(key.toLowerCase())) {
      out[key] = REDACTED_PLACEHOLDER;
      continue;
    }
    out[key] = redactValue(value, keySet);
  }
  return out;
}

/**
 * 替换 `obj` 中所有匹配 `keys`（大小写不敏感）的字段值为 `"[REDACTED]"`。
 *
 * - 不修改 `obj` 本身；返回新结构；
 * - 递归处理嵌套对象与数组；
 * - 默认仅处理朴素对象（Date / Buffer / Map / Set 不展开，避免误伤）。
 */
export function redactSecrets<T extends Record<string, unknown>>(
  obj: T,
  keys: ReadonlyArray<string> = DEFAULT_SECRET_KEYS
): T {
  if (!obj || typeof obj !== "object") {
    return obj;
  }
  const keySet = buildLowerCaseKeySet(keys);
  return redactObject(obj, keySet) as T;
}

/**
 * `redactSecrets` 在 DEFAULT_SECRET_KEYS 下的简便包装，用于日志记录。
 */
export function sanitizeForLogging<T extends Record<string, unknown>>(obj: T): T {
  return redactSecrets(obj, DEFAULT_SECRET_KEYS);
}
