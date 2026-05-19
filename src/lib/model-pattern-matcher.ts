import { resolveProviderPatternRegex } from "@/lib/provider-pattern-regex";
import type { ProviderModelRedirectMatchType } from "@/types/provider";

export function matchesPattern(
  model: string,
  matchType: ProviderModelRedirectMatchType,
  pattern: string
): boolean {
  switch (matchType) {
    case "exact":
      return model === pattern;
    case "prefix":
      return model.startsWith(pattern);
    case "suffix":
      return model.endsWith(pattern);
    case "contains":
      return model.includes(pattern);
    case "regex": {
      // 不隐式补 ^/$，需要全字符串匹配时请显式写成 ^pattern$。
      // 解析失败时尝试把 `*`/`?` 当 glob 通配符，兼容旧版输入习惯。
      const compiled = resolveProviderPatternRegex(pattern);
      return compiled ? compiled.regex.test(model) : false;
    }
    default:
      return false;
  }
}
