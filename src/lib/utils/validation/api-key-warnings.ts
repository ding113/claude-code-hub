export type ApiKeyWarningId =
  | "looks_like_auth_header"
  | "wrapped_in_quotes"
  | "contains_non_ascii"
  | "contains_whitespace"
  | "contains_uncommon_ascii";

function isWrappedInQuotes(value: string): boolean {
  return (
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  );
}

function looksLikeAuthHeader(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.startsWith("bearer ") ||
    lower.startsWith("authorization:") ||
    lower.startsWith("x-api-key:") ||
    lower.startsWith("api-key:") ||
    lower.startsWith("x-goog-api-key:")
  );
}

function containsNonAscii(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code != null && code > 0x7f) return true;
  }
  return false;
}

function containsUncommonAscii(value: string): boolean {
  // 常见 token 格式：base64/base64url/jwt 等通常仅由如下字符组成
  // - 字母数字
  // - _ - .
  // - base64 的 + / =
  // 其它 ASCII 标点大多来自误粘贴（如引号、逗号、分号、@ 等），因此仅作提醒。
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code == null) continue;
    if (code > 0x7f) continue; // 非 ASCII 在别处提示
    if (code <= 0x20 || code === 0x7f) continue; // 空白/控制字符在别处提示
    if (/[a-zA-Z0-9._\-+/=]/.test(ch)) continue;
    return true;
  }

  return false;
}

/**
 * 检测“很可能不是常见 API Key”的输入特征，仅用于 UI 警告（不阻止保存）。
 *
 * 注意：某些上游可能允许非 ASCII / 含空白的 key，但一般情况下不常见，因此仅作提醒。
 */
export function detectApiKeyWarnings(rawKey: string): ApiKeyWarningId[] {
  const trimmed = rawKey.trim();
  if (!trimmed) return [];

  const warnings: ApiKeyWarningId[] = [];

  const isLikelyJsonCredentials = trimmed.startsWith("{");

  if (looksLikeAuthHeader(trimmed)) {
    warnings.push("looks_like_auth_header");
  }

  if (isWrappedInQuotes(trimmed)) {
    warnings.push("wrapped_in_quotes");
  }

  if (containsNonAscii(trimmed)) {
    warnings.push("contains_non_ascii");
  }

  if (!isLikelyJsonCredentials && /\s/.test(rawKey)) {
    warnings.push("contains_whitespace");
  }

  if (!isLikelyJsonCredentials && containsUncommonAscii(trimmed)) {
    warnings.push("contains_uncommon_ascii");
  }

  return warnings;
}
