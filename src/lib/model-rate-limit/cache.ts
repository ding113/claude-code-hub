/**
 * Model-limit resolution snapshot cache (§4.7 / §17.3).
 *
 * Single in-process snapshot (OPT-E: target scale <= 10k users) feeding the pure
 * resolver. L1 + Redis pub/sub invalidation (mirrors provider-cache.ts) plus
 * stale-while-revalidate (OPT-C): a stale read serves the old snapshot and kicks a
 * background refresh; only a true cold start awaits. Writes call
 * publishModelLimitCacheInvalidation() which rebuilds locally (read-your-writes)
 * then broadcasts so other pods mark stale + serve-stale.
 */

import "server-only";

import { logger } from "@/lib/logger";
import { publishCacheInvalidation, subscribeCacheInvalidation } from "@/lib/redis/pubsub";
import { listModelGroups } from "@/repository/model-group";
import { listAllModelGroupLimits } from "@/repository/model-group-limit";
import { listAllActiveAndFutureGrants } from "@/repository/quota-boost";
import { listUserGroups } from "@/repository/user-group";
import { modelLimitSourceKey, resolveModelLimitsFromSnapshot } from "./resolver";
import type {
  BoostGrant,
  ModelLimitBucket,
  ModelLimitResolveParams,
  ModelLimitSnapshot,
  ModelLimitSource,
} from "./types";

export const CHANNEL_MODEL_LIMITS_UPDATED = "cch:cache:model-limits:updated";

const CACHE_TTL_MS = 30_000;

interface SnapshotState {
  data: ModelLimitSnapshot | null;
  expiresAt: number;
  version: number;
  refreshPromise: Promise<ModelLimitSnapshot> | null;
}

const cache: SnapshotState = {
  data: null,
  expiresAt: 0,
  version: 0,
  refreshPromise: null,
};

/** Build the full snapshot from the repositories (one batch of indexed reads). */
export async function buildModelLimitSnapshot(): Promise<ModelLimitSnapshot> {
  const [groups, userGroups, limits, grants] = await Promise.all([
    listModelGroups(),
    listUserGroups(),
    listAllModelGroupLimits(),
    listAllActiveAndFutureGrants(),
  ]);

  const modelToGroupId = new Map<string, number>();
  const groupMembers = new Map<number, readonly string[]>();
  for (const g of groups) {
    groupMembers.set(g.id, g.members);
    for (const model of g.members) {
      modelToGroupId.set(model, g.id);
    }
  }

  const limitsMap = new Map<string, ModelLimitSource>();
  for (const row of limits) {
    limitsMap.set(modelLimitSourceKey(row.subjectType, row.subjectId, row.modelGroupId), {
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      caps: {
        limit5hUsd: row.limit5hUsd,
        limit5hResetMode: row.limit5hResetMode,
        dailyLimitUsd: row.dailyLimitUsd,
        limitWeeklyUsd: row.limitWeeklyUsd,
        limitMonthlyUsd: row.limitMonthlyUsd,
        limitTotalUsd: row.limitTotalUsd,
        limit5hCostResetAt: row.limit5hCostResetAt,
      },
    });
  }

  const userGroupIdsByTag = new Map<string, number[]>();
  for (const ug of userGroups) {
    const existing = userGroupIdsByTag.get(ug.tag);
    if (existing) existing.push(ug.id);
    else userGroupIdsByTag.set(ug.tag, [ug.id]);
  }

  const boostGrantsByUser = new Map<number, BoostGrant[]>();
  for (const grant of grants) {
    const bg: BoostGrant = {
      modelGroupId: grant.modelGroupId,
      window: grant.window,
      amountUsd: Number(grant.amountUsd),
      validFrom: grant.validFrom,
      validTo: grant.validTo,
    };
    const existing = boostGrantsByUser.get(grant.userId);
    if (existing) existing.push(bg);
    else boostGrantsByUser.set(grant.userId, [bg]);
  }

  return { modelToGroupId, groupMembers, limits: limitsMap, userGroupIdsByTag, boostGrantsByUser };
}

let fetcher: () => Promise<ModelLimitSnapshot> = buildModelLimitSnapshot;

/** Override the snapshot fetcher (tests / dependency injection). */
export function configureModelLimitSnapshotFetcher(next: () => Promise<ModelLimitSnapshot>): void {
  fetcher = next;
}

let subscriptionInitialized = false;
let subscriptionInitPromise: Promise<void> | null = null;

async function ensureSubscription(): Promise<void> {
  if (subscriptionInitialized) return;
  if (subscriptionInitPromise) return subscriptionInitPromise;

  subscriptionInitPromise = (async () => {
    if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") {
      subscriptionInitialized = true;
      return;
    }
    try {
      const cleanup = await subscribeCacheInvalidation(CHANNEL_MODEL_LIMITS_UPDATED, () => {
        markStale();
        logger.debug("[ModelLimitCache] Marked stale via pub/sub");
      });
      if (!cleanup) return;
      subscriptionInitialized = true;
    } catch (error) {
      logger.warn("[ModelLimitCache] Failed to subscribe to cache invalidation", { error });
    }
  })().finally(() => {
    subscriptionInitPromise = null;
  });

  return subscriptionInitPromise;
}

/**
 * Mark the snapshot stale while keeping the old data for serve-stale (OPT-C).
 * Bumps version so any in-flight refresh won't commit; abandons its promise so
 * the next read starts a fresh refresh.
 */
function markStale(): void {
  cache.expiresAt = 0;
  cache.version++;
  cache.refreshPromise = null;
}

/** Drop all cached data (cold reset). Mainly for tests. */
export function resetModelLimitCache(): void {
  cache.data = null;
  cache.expiresAt = 0;
  cache.version++;
  cache.refreshPromise = null;
}

function triggerRefresh(): Promise<ModelLimitSnapshot> {
  if (cache.refreshPromise) return cache.refreshPromise;

  const startVersion = cache.version;
  cache.refreshPromise = (async () => {
    try {
      const data = await fetcher();
      if (cache.version === startVersion) {
        cache.data = data;
        cache.expiresAt = Date.now() + CACHE_TTL_MS;
      }
      return data;
    } finally {
      if (cache.version === startVersion) {
        cache.refreshPromise = null;
      }
    }
  })();

  return cache.refreshPromise;
}

/**
 * Get the resolution snapshot (stale-while-revalidate).
 * - fresh   -> return immediately
 * - stale   -> serve old snapshot + background refresh (no blocking)
 * - cold    -> await the first build (only blocks on process start)
 */
export async function getModelLimitSnapshot(): Promise<ModelLimitSnapshot> {
  void ensureSubscription();

  if (cache.data) {
    if (cache.expiresAt > Date.now()) return cache.data;
    void triggerRefresh().catch((error) => {
      logger.warn("[ModelLimitCache] Background refresh failed (serving stale)", { error });
    });
    return cache.data;
  }

  return triggerRefresh();
}

/**
 * Publish cache invalidation after an admin write. Rebuilds locally first
 * (read-your-writes on the writing pod, OPT-C Option 2), then broadcasts so
 * other pods mark stale and serve-stale until their own background refresh lands.
 */
export async function publishModelLimitCacheInvalidation(): Promise<void> {
  markStale();
  try {
    await triggerRefresh();
  } catch (error) {
    logger.warn("[ModelLimitCache] Local rebuild after write failed", { error });
  }
  await publishCacheInvalidation(CHANNEL_MODEL_LIMITS_UPDATED);
  logger.debug("[ModelLimitCache] Published cache invalidation");
}

/** Warm the snapshot at startup (best-effort). */
export async function warmupModelLimitCache(): Promise<void> {
  try {
    await getModelLimitSnapshot();
    logger.info("[ModelLimitCache] Snapshot warmed up");
  } catch (error) {
    logger.warn("[ModelLimitCache] Warmup failed", { error });
  }
}

/**
 * Resolve enforceable buckets for a request. Degrades to [] (mainline fallback)
 * if the snapshot cannot be built, so a cache/DB failure never blocks the proxy.
 */
export async function resolveModelLimits(
  params: ModelLimitResolveParams
): Promise<ModelLimitBucket[]> {
  try {
    const snapshot = await getModelLimitSnapshot();
    return resolveModelLimitsFromSnapshot(snapshot, params);
  } catch (error) {
    logger.warn("[ModelLimitCache] resolveModelLimits failed, falling back to mainline", { error });
    return [];
  }
}

export function getModelLimitCacheStats(): {
  hasData: boolean;
  expiresIn: number;
  version: number;
  isRefreshing: boolean;
} {
  return {
    hasData: cache.data !== null,
    expiresIn: Math.max(0, cache.expiresAt - Date.now()),
    version: cache.version,
    isRefreshing: cache.refreshPromise !== null,
  };
}
