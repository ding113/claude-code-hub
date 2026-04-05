import type { ProviderAllowedModelRule, ProviderModelRedirectMatchType } from "@/types/provider";
import { matchPattern } from "./model-pattern-matching";

const ALLOWED_MODEL_MATCH_TYPES = new Set<ProviderModelRedirectMatchType>([
  "exact",
  "prefix",
  "suffix",
  "contains",
  "regex",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProviderAllowedModelRule(value: unknown): value is ProviderAllowedModelRule {
  if (!isRecord(value)) {
    return false;
  }

  const matchType = value.matchType;
  const pattern = typeof value.pattern === "string" ? value.pattern.trim() : null;

  return (
    typeof matchType === "string" &&
    ALLOWED_MODEL_MATCH_TYPES.has(matchType as ProviderModelRedirectMatchType) &&
    !!pattern
  );
}

export function isProviderAllowedModelRuleList(
  value: unknown
): value is ProviderAllowedModelRule[] {
  return Array.isArray(value) && value.every((rule) => isProviderAllowedModelRule(rule));
}

function normalizeRule(rule: ProviderAllowedModelRule): ProviderAllowedModelRule {
  return {
    matchType: rule.matchType,
    pattern: rule.pattern.trim(),
  };
}

/**
 * 规范化 allowedModels 字段
 *
 * 支持两种格式：
 * - 新格式 ProviderAllowedModelRule[]：直接通过（trim）
 * - 旧格式 string[]：转为 exact 匹配规则
 */
export function normalizeAllowedModelRules(value: unknown): ProviderAllowedModelRule[] | null {
  if (value == null) {
    return null;
  }

  // 新格式：ProviderAllowedModelRule[]
  if (isProviderAllowedModelRuleList(value)) {
    return value.map(normalizeRule);
  }

  // 旧格式：string[]
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return (value as string[])
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(
        (pattern): ProviderAllowedModelRule => ({
          matchType: "exact",
          pattern,
        })
      );
  }

  return null;
}

export function hasAllowedModelRules(
  rules: ProviderAllowedModelRule[] | null | undefined
): boolean {
  return Array.isArray(rules) && rules.length > 0;
}

/**
 * 检查模型是否匹配白名单规则
 *
 * - null/undefined/空数组 -> true（允许所有模型）
 * - 有规则时 -> 任意一条匹配即为 true
 */
export function modelMatchesAllowedRules(
  model: string,
  rules: ProviderAllowedModelRule[] | null | undefined
): boolean {
  if (!hasAllowedModelRules(rules)) {
    return true;
  }

  return rules!.some((rule) => matchPattern(model, rule.matchType, rule.pattern));
}
