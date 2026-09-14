import { getCachedSystemSettingsOnlyCache } from "@/lib/config/system-settings-cache";

/**
 * Dashboard aggregate caches keep longer TTLs in high-concurrency mode, trading freshness for fewer
 * usage_ledger aggregations. Reads the in-memory settings snapshot only (never queries).
 */
export function resolveDashboardCacheTtlSeconds(
  defaultTtlSeconds: number,
  highConcurrencyTtlSeconds: number
): number {
  return getCachedSystemSettingsOnlyCache()?.enableHighConcurrencyMode === true
    ? highConcurrencyTtlSeconds
    : defaultTtlSeconds;
}
