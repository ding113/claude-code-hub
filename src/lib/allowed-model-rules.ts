import { matchesPattern } from "@/lib/model-pattern-matcher";
import type {
  AllowedModelRule,
  AllowedModelRuleInput,
  ProviderModelRedirectMatchType,
} from "@/types/provider";

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

function trimString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

export function isAllowedModelRule(value: unknown): value is AllowedModelRule {
  if (!isRecord(value)) {
    return false;
  }

  const matchType = value.matchType;
  const pattern = trimString(value.pattern);

  return (
    typeof matchType === "string" &&
    ALLOWED_MODEL_MATCH_TYPES.has(matchType as ProviderModelRedirectMatchType) &&
    !!pattern
  );
}

export function normalizeAllowedModelRule(value: AllowedModelRuleInput): AllowedModelRule | null {
  if (typeof value === "string") {
    const pattern = value.trim();
    if (!pattern) {
      return null;
    }
    return {
      matchType: "exact",
      pattern,
    };
  }

  if (!isAllowedModelRule(value)) {
    return null;
  }

  return {
    matchType: value.matchType,
    pattern: value.pattern.trim(),
  };
}

export function normalizeAllowedModelRules(value: unknown): AllowedModelRule[] | null {
  if (value == null) {
    return null;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  return value
    .map((item) => normalizeAllowedModelRule(item as AllowedModelRuleInput))
    .filter((rule): rule is AllowedModelRule => rule !== null);
}

export function matchesAllowedModelRules(
  model: string,
  rules: AllowedModelRuleInput[] | null | undefined
): boolean {
  if (!rules || rules.length === 0) {
    return true;
  }

  const normalized = normalizeAllowedModelRules(rules);
  if (!normalized || normalized.length === 0) {
    return false;
  }

  return normalized.some((rule) => matchesPattern(model, rule.matchType, rule.pattern));
}

export function findMatchingAllowedModelRule(
  model: string,
  rules: AllowedModelRuleInput[] | null | undefined
): AllowedModelRule | null {
  if (!model || !rules || rules.length === 0) {
    return null;
  }

  const normalized = normalizeAllowedModelRules(rules);
  if (!normalized || normalized.length === 0) {
    return null;
  }

  for (const rule of normalized) {
    if (matchesPattern(model, rule.matchType, rule.pattern)) {
      return rule;
    }
  }

  return null;
}
