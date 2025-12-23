import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";

/**
 * Normalize provider group value to a consistent format
 * - Returns "default" for null/undefined/empty values
 * - Trims whitespace and removes duplicates
 * - Sorts groups alphabetically for consistency
 */
export function normalizeProviderGroup(value: unknown): string {
  if (value === null || value === undefined) return PROVIDER_GROUP.DEFAULT;
  if (typeof value !== "string") return PROVIDER_GROUP.DEFAULT;
  const trimmed = value.trim();
  if (trimmed === "") return PROVIDER_GROUP.DEFAULT;

  const groups = trimmed
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  if (groups.length === 0) return PROVIDER_GROUP.DEFAULT;

  return Array.from(new Set(groups)).sort().join(",");
}

/**
 * Parse a comma-separated provider group string into an array
 */
export function parseProviderGroups(value: string): string[] {
  return value
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}
