import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";

const PROVIDER_GROUP_SEPARATOR = /[,，\n\r]+/;

function splitProviderGroupValue(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(PROVIDER_GROUP_SEPARATOR)
    .map((group) => group.trim())
    .filter(Boolean);
}

/**
 * Normalize provider group value to a consistent format
 * - Returns "default" for null/undefined/empty values
 * - Trims whitespace and removes duplicates
 * - Sorts groups alphabetically for consistency
 */
export function normalizeProviderGroup(value: unknown): string {
  const groups = splitProviderGroupValue(value);
  if (groups.length === 0) return PROVIDER_GROUP.DEFAULT;

  return Array.from(new Set(groups)).sort().join(",");
}

/**
 * Normalize provider group tag string for provider.groupTag storage.
 * - Supports English comma, Chinese comma and line breaks as separators
 * - Trims whitespace and removes duplicates while preserving input order
 * - Returns null for null/undefined/empty values
 */
export function normalizeProviderGroupTag(value: unknown): string | null {
  const groups = splitProviderGroupValue(value);
  if (groups.length === 0) return null;

  return Array.from(new Set(groups)).join(",");
}

/**
 * Parse a provider group / groupTag string into an array.
 * Supports English comma, Chinese comma and line breaks as separators.
 */
export function parseProviderGroups(value: unknown): string[] {
  return splitProviderGroupValue(value);
}

/**
 * 仅在明确需要“未分组 provider 也属于 default 组”语义的调用点使用。
 * 原始解析语义保持不变：空输入仍然由 parseProviderGroups 返回 []。
 */
export function resolveProviderGroupsWithDefault(value: unknown): string[] {
  const groups = parseProviderGroups(value);
  if (groups.length === 0) {
    return [PROVIDER_GROUP.DEFAULT];
  }

  return groups;
}
