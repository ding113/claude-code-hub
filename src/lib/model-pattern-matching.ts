import type { ProviderModelRedirectMatchType } from "@/types/provider";

/**
 * 通用模式匹配函数
 *
 * 支持 5 种匹配类型：exact / prefix / suffix / contains / regex
 * 被模型重定向规则和模型白名单规则共同复用
 */
export function matchPattern(
  value: string,
  matchType: ProviderModelRedirectMatchType,
  pattern: string
): boolean {
  switch (matchType) {
    case "exact":
      return value === pattern;
    case "prefix":
      return value.startsWith(pattern);
    case "suffix":
      return value.endsWith(pattern);
    case "contains":
      return value.includes(pattern);
    case "regex":
      try {
        return new RegExp(pattern).test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}
