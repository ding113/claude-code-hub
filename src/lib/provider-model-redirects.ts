import type { ProviderModelRedirectMatchType, ProviderModelRedirectRule } from "@/types/provider";
import { matchPattern } from "./model-pattern-matching";

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
  return matchPattern(model, rule.matchType, rule.source);
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

export function getProviderModelRedirectTarget(
  model: string,
  rules: ProviderModelRedirectRule[] | null | undefined
): string {
  return findMatchingProviderModelRedirectRule(model, rules)?.target ?? model;
}
