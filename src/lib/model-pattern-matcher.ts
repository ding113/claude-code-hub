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
    case "regex":
      try {
        return new RegExp(pattern).test(model);
      } catch {
        return false;
      }
    default:
      return false;
  }
}
