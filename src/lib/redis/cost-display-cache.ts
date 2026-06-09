import type Redis from "ioredis";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { logger } from "@/lib/logger";

export type CostCacheEntityType = "key" | "user" | "provider";
export type CostCacheRollingPeriod = "5h" | "daily";

export interface CostCacheEntry {
  type: CostCacheEntityType;
  id: number;
  period: CostCacheRollingPeriod;
}

const FALLBACK_TTL_SECONDS = 10;

// bugfix #05: hard runtime floor so the cache TTL can never collapse below the
// jitter band. Even if validation lets through a smaller refresh interval, the
// resolved TTL stays >= MIN_EFFECTIVE_TTL — preventing dashboard polling from
// stampeding the DB with sumXxxCostInTimeRange queries (slowlog regression).
const MIN_EFFECTIVE_TTL = 3;
const JITTER_SECONDS = 1;

export const COST_CACHE_KEY_PREFIX = "cost_cache" as const;

export function buildCostDisplayCacheKey(
  type: CostCacheEntityType,
  id: number,
  period: CostCacheRollingPeriod
): string {
  return `${COST_CACHE_KEY_PREFIX}:${type}:${id}:${period}_rolling`;
}

// bugfix #10: single source of truth for the display-cache scan pattern.
// Cleanup paths (reset / admin-clear / cost rollback) must use this so a future
// rename of the key layout cannot leave cleanup pointing at the old pattern.
export function buildCostDisplayCacheScanPattern(type: CostCacheEntityType, id: number): string {
  return `${COST_CACHE_KEY_PREFIX}:${type}:${id}:*`;
}

async function resolveCacheTtlSeconds(): Promise<number> {
  let configured = FALLBACK_TTL_SECONDS;
  try {
    const settings = await getCachedSystemSettings();
    configured = settings.quotaDbRefreshIntervalSeconds ?? FALLBACK_TTL_SECONDS;
  } catch (error) {
    logger.warn("[CostDisplayCache] Failed to resolve TTL, falling back to default", { error });
  }
  // bugfix #05: enforce MIN_EFFECTIVE_TTL on both sides of the jitter window
  // so the worst case (negative jitter against the minimum) cannot drop below
  // the floor. Schema validation already rejects <5 at config time; this is
  // the runtime safety net for in-flight settings or older configurations.
  const base = Math.max(MIN_EFFECTIVE_TTL, configured);
  const jitter = Math.random() < 0.5 ? -JITTER_SECONDS : JITTER_SECONDS;
  return Math.max(MIN_EFFECTIVE_TTL, base + jitter);
}

function parseCachedCost(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getCachedRollingCost(
  redis: Redis,
  type: CostCacheEntityType,
  id: number,
  period: CostCacheRollingPeriod
): Promise<number | null> {
  const key = buildCostDisplayCacheKey(type, id, period);
  const raw = await redis.get(key);
  return parseCachedCost(raw);
}

export interface SetCachedRollingCostOptions {
  // bugfix #09: ms timestamp at which the earliest ledger row inside the window
  // will fall out. When provided, the resolved TTL is clamped to (boundary - now)
  // (floored at MIN_EFFECTIVE_TTL) so the cache cannot serve stale "limit reached"
  // values for the full configured TTL after the window slides past that row.
  boundaryAtMs?: number;
}

export async function setCachedRollingCost(
  redis: Redis,
  type: CostCacheEntityType,
  id: number,
  period: CostCacheRollingPeriod,
  cost: number,
  options?: SetCachedRollingCostOptions
): Promise<void> {
  const key = buildCostDisplayCacheKey(type, id, period);
  const configuredTtl = await resolveCacheTtlSeconds();
  let ttl = configuredTtl;
  const boundary = options?.boundaryAtMs;
  if (typeof boundary === "number" && Number.isFinite(boundary)) {
    const remainingSec = Math.floor((boundary - Date.now()) / 1000);
    ttl = Math.max(MIN_EFFECTIVE_TTL, Math.min(configuredTtl, remainingSec));
  }
  await redis.set(key, cost.toString(), "EX", ttl);
}

export async function mgetCachedRollingCost(
  redis: Redis,
  entries: CostCacheEntry[]
): Promise<Array<number | null>> {
  if (entries.length === 0) return [];
  const keys = entries.map((e) => buildCostDisplayCacheKey(e.type, e.id, e.period));
  const raw = await redis.mget(...keys);
  return raw.map(parseCachedCost);
}
