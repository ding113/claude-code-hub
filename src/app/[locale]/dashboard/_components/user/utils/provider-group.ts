import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";

/**
 * Normalize provider group value to a consistent format.
 * - Trims whitespace
 * - Splits by comma and deduplicates
 * - Sorts alphabetically
 * - Returns DEFAULT if empty or invalid
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
