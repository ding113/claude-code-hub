/**
 * Keyword match rules for classifying upstream site group names into CCH
 * provider_groups (dispatch pools). Same match types as model redirect / allowlist.
 *
 * Classification is fully driven by provider_groups.match_rules + sort_order.
 * There is no hard-coded builtin keyword table once groups are configured.
 */

import { matchesPattern } from "@/lib/model-pattern-matcher";
import type { ProviderModelRedirectMatchType } from "@/types/provider";

export type ProviderGroupMatchType = ProviderModelRedirectMatchType;

export type ProviderGroupMatchRule = {
  matchType: ProviderGroupMatchType;
  pattern: string;
};

const MATCH_TYPES = new Set<ProviderGroupMatchType>([
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

export function isProviderGroupMatchRule(value: unknown): value is ProviderGroupMatchRule {
  if (!isRecord(value)) return false;
  const matchType = value.matchType;
  const pattern = trimString(value.pattern);
  return (
    typeof matchType === "string" &&
    MATCH_TYPES.has(matchType as ProviderGroupMatchType) &&
    !!pattern
  );
}

export function normalizeProviderGroupMatchRule(
  value: ProviderGroupMatchRule
): ProviderGroupMatchRule {
  return {
    matchType: value.matchType,
    pattern: value.pattern.trim(),
  };
}

export function normalizeProviderGroupMatchRules(
  value: unknown
): ProviderGroupMatchRule[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const rules = value
    .filter(isProviderGroupMatchRule)
    .map(normalizeProviderGroupMatchRule)
    .filter((rule) => rule.pattern.length > 0);
  return rules.length > 0 ? rules : null;
}

/**
 * Case-insensitive for exact/prefix/suffix/contains so site group names like
 * "Claude Kiro" match patterns "claude". Regex keeps user pattern as written
 * (same engine as model redirects).
 */
export function matchesProviderGroupRule(
  groupName: string,
  rule: ProviderGroupMatchRule
): boolean {
  if (rule.matchType === "regex") {
    return matchesPattern(groupName, rule.matchType, rule.pattern);
  }
  const haystack = groupName.toLowerCase();
  const needle = rule.pattern.toLowerCase();
  return matchesPattern(haystack, rule.matchType, needle);
}

export function groupMatchesAnyRule(
  groupName: string,
  rules: ProviderGroupMatchRule[] | null | undefined
): boolean {
  if (!rules?.length) return false;
  return rules.some((rule) => matchesProviderGroupRule(groupName, rule));
}

export type ClassifiableProviderGroup = {
  name: string;
  sortOrder?: number | null;
  matchRules?: ProviderGroupMatchRule[] | null;
};

/**
 * Classify using ordered provider groups' match rules.
 * First group (by sortOrder, then name) with a matching rule wins.
 * Groups named "default" are skipped. Empty rules on a group are skipped.
 * No match / no rules configured → "other" (no hard-coded keyword fallback).
 */
export function classifySiteGroupTagWithGroups(
  groupName: string,
  groups: ClassifiableProviderGroup[] | null | undefined
): string {
  const text = groupName.trim();
  if (!text) return "other";

  const ordered = [...(groups ?? [])]
    .filter((g) => g.name && g.name !== "default")
    .sort((a, b) => {
      const ao = a.sortOrder ?? 0;
      const bo = b.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });

  for (const group of ordered) {
    if (groupMatchesAnyRule(text, group.matchRules)) {
      return group.name;
    }
  }
  return "other";
}
