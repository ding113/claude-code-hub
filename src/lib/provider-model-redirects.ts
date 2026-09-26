import { matchesPattern } from "@/lib/model-pattern-matcher";
import { resolveProviderPatternRegex } from "@/lib/provider-pattern-regex";
import type { ProviderModelRedirectMatchType, ProviderModelRedirectRule } from "@/types/provider";

const PROVIDER_MODEL_REDIRECT_MATCH_TYPES = new Set<ProviderModelRedirectMatchType>([
  "exact",
  "prefix",
  "suffix",
  "contains",
  "regex",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

export function isProviderModelRedirectRule(value: unknown): value is ProviderModelRedirectRule {
  if (!isRecord(value)) {
    return false;
  }

  const matchType = value.matchType;
  const source = trimString(value.source);
  const target = trimString(value.target);

  return (
    typeof matchType === "string" &&
    PROVIDER_MODEL_REDIRECT_MATCH_TYPES.has(matchType as ProviderModelRedirectMatchType) &&
    !!source &&
    !!target
  );
}

export function isProviderModelRedirectRuleList(
  value: unknown
): value is ProviderModelRedirectRule[] {
  return Array.isArray(value) && value.every((rule) => isProviderModelRedirectRule(rule));
}

export function normalizeProviderModelRedirectRule(
  value: ProviderModelRedirectRule
): ProviderModelRedirectRule {
  return {
    matchType: value.matchType,
    source: value.source.trim(),
    target: value.target.trim(),
  };
}

export function normalizeProviderModelRedirectRules(
  value: unknown
): ProviderModelRedirectRule[] | null {
  if (value == null) {
    return null;
  }

  if (isProviderModelRedirectRuleList(value)) {
    return value.map((rule) => normalizeProviderModelRedirectRule(rule));
  }

  if (!isRecord(value)) {
    return null;
  }

  const normalized = Object.entries(value)
    .map(([source, target]): ProviderModelRedirectRule | null => {
      const normalizedSource = source.trim();
      const normalizedTarget = trimString(target);
      if (!normalizedSource || !normalizedTarget) {
        return null;
      }

      return {
        matchType: "exact" as const,
        source: normalizedSource,
        target: normalizedTarget,
      };
    })
    .filter((rule): rule is ProviderModelRedirectRule => rule !== null);

  return normalized;
}

export function hasProviderModelRedirectRules(
  rules: ProviderModelRedirectRule[] | null | undefined
): boolean {
  return Array.isArray(rules) && rules.length > 0;
}

export function matchesProviderModelRedirectRule(
  model: string,
  rule: ProviderModelRedirectRule
): boolean {
  return matchesPattern(model, rule.matchType, rule.source);
}

export function findMatchingProviderModelRedirectRule(
  model: string,
  rules: ProviderModelRedirectRule[] | null | undefined
): ProviderModelRedirectRule | null {
  if (!model || !hasProviderModelRedirectRules(rules)) {
    return null;
  }

  for (const rule of rules ?? []) {
    if (matchesProviderModelRedirectRule(model, rule)) {
      return rule;
    }
  }

  return null;
}

// regex 规则的 target 支持引用捕获组（`$1` / `$&` / `$<name>`），语义仍然是「整串替换成 target」，
// 而不是 sed 式的局部替换：`contains`/未加锚点的正则命中子串时，旧配置依赖的仍是整串改写。
// 实现上借 String.replace 做原生的 `$` 展开，再用哨兵切掉未参与匹配的前后缀，避免自己实现一套展开规则。
const TARGET_EXPANSION_SENTINEL = "\u0000";

export function resolveProviderModelRedirectTarget(
  model: string,
  rule: ProviderModelRedirectRule
): string {
  if (rule.matchType !== "regex" || !rule.target.includes("$")) {
    return rule.target;
  }

  const compiled = resolveProviderPatternRegex(rule.source);
  if (!compiled?.regex.test(model)) {
    return rule.target;
  }

  const expanded = model.replace(
    compiled.regex,
    `${TARGET_EXPANSION_SENTINEL}${rule.target}${TARGET_EXPANSION_SENTINEL}`
  );
  return expanded.slice(
    expanded.indexOf(TARGET_EXPANSION_SENTINEL) + 1,
    expanded.lastIndexOf(TARGET_EXPANSION_SENTINEL)
  );
}

export function getProviderModelRedirectTarget(
  model: string,
  rules: ProviderModelRedirectRule[] | null | undefined
): string {
  const rule = findMatchingProviderModelRedirectRule(model, rules);
  return rule ? resolveProviderModelRedirectTarget(model, rule) : model;
}
