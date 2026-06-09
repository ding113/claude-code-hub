/**
 * Bucket Rate Limit Service (group-rate-limit §6 / §17.1).
 *
 * Checks and decrements one resolved bucket's cost windows. The 5h/daily/weekly/
 * monthly windows go through BucketLeaseService (Redis lease + DB authority). The
 * all-time `total` window uses an OPT-A read-through cache (total_cost:model:*,
 * 300s TTL) instead of a per-request near-full-history DB aggregation.
 *
 * The model-bucket total counts ALL consumption on the group's member models and
 * is NOT filtered by counted_in_*_global — the model bucket is its own budget,
 * independent of whether the mainline global axis was bypassed.
 */

import { logger } from "@/lib/logger";
import type { LeaseWindowType } from "@/lib/rate-limit/lease";
import type { DailyResetMode } from "@/lib/rate-limit/time-utils";
import { getRedisClient } from "@/lib/redis";
import { sumScopeCostByModelsInTimeRange } from "@/repository/statistics";
import { BucketLeaseService } from "./bucket-lease";
import type { LimitWindow, ModelLimitBucket } from "./types";

export interface BucketCheckResult {
  allowed: boolean;
  /** A window/lease could not be evaluated (Redis/DB failure) -> do not set bypass. */
  failOpen?: boolean;
  /** Set only when allowed === false. */
  window?: LimitWindow;
  currentUsage?: number;
  limitValue?: number;
}

// Kept short so the all-time total window cannot overshoot by much more than the
// lease windows (which refresh on quotaDbRefreshIntervalSeconds, default 10s).
// getModelGroupTotalUsage only runs when a total cap is configured, so the
// extra full-history aggregation is opt-in and rare.
const TOTAL_COST_CACHE_TTL_SECONDS = 60;

interface WindowSpec {
  window: LeaseWindowType;
  limit: number | null;
  resetMode: DailyResetMode;
  costResetAt: Date | null;
}

function leaseWindowSpecs(bucket: ModelLimitBucket): WindowSpec[] {
  const { caps } = bucket;
  return [
    {
      window: "5h",
      limit: caps.limit5hUsd,
      resetMode: caps.limit5hResetMode,
      costResetAt: caps.limit5hCostResetAt,
    },
    { window: "daily", limit: caps.dailyLimitUsd, resetMode: "fixed", costResetAt: null },
    { window: "weekly", limit: caps.limitWeeklyUsd, resetMode: "fixed", costResetAt: null },
    { window: "monthly", limit: caps.limitMonthlyUsd, resetMode: "fixed", costResetAt: null },
  ];
}

/** OPT-A: read-through cached all-time usage on the group's member models. */
async function getModelGroupTotalUsage(bucket: ModelLimitBucket): Promise<number> {
  const { axis, scopeId, modelGroupId, models } = bucket;
  const cacheKey = `total_cost:model:${axis}:${scopeId}:${modelGroupId}`;
  const redis = getRedisClient();

  if (redis && redis.status === "ready") {
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      const value = Number(cached);
      if (Number.isFinite(value)) return value;
    }
  }

  const usage = await sumScopeCostByModelsInTimeRange(
    axis,
    scopeId,
    models,
    new Date(0),
    new Date()
  );

  if (redis && redis.status === "ready") {
    // Async write-back; never block the request on cache population.
    void redis
      .setex(cacheKey, TOTAL_COST_CACHE_TTL_SECONDS, String(usage))
      .catch((error) => logger.debug("[BucketService] total cache write-back failed", { error }));
  }

  return usage;
}

export class BucketRateLimitService {
  /**
   * Check all cost windows for one bucket. Lease windows run in parallel with the
   * total lookup. Returns the first violation in [5h, daily, weekly, monthly, total]
   * order. `failOpen` is set when any window could not be evaluated, so the guard
   * keeps the mainline global gate for that axis (no double pass-through).
   */
  static async checkCostLimits(bucket: ModelLimitBucket): Promise<BucketCheckResult> {
    try {
      const { axis, scopeId, modelGroupId, models, caps } = bucket;
      const specs = leaseWindowSpecs(bucket);

      const [leaseResults, totalUsage] = await Promise.all([
        Promise.all(
          specs.map(async (spec) => {
            if (spec.limit === null || spec.limit === undefined || spec.limit <= 0) {
              return { spec, lease: undefined };
            }
            const lease = await BucketLeaseService.getCostLease({
              axis,
              scopeId,
              modelGroupId,
              models,
              window: spec.window,
              limitAmount: spec.limit,
              resetMode: spec.resetMode,
              costResetAt: spec.costResetAt,
            });
            return { spec, lease };
          })
        ),
        caps.limitTotalUsd !== null && caps.limitTotalUsd !== undefined
          ? getModelGroupTotalUsage(bucket)
          : Promise.resolve(null),
      ]);

      let failOpen = false;
      for (const { spec, lease } of leaseResults) {
        if (lease === undefined) continue; // no limit configured for this window
        if (lease === null) {
          failOpen = true; // lease retrieval failed -> cannot enforce this window
          continue;
        }
        if (lease.remainingBudget <= 0) {
          return {
            allowed: false,
            window: spec.window,
            currentUsage: lease.currentUsage,
            limitValue: spec.limit ?? undefined,
          };
        }
      }

      if (
        totalUsage !== null &&
        caps.limitTotalUsd !== null &&
        caps.limitTotalUsd !== undefined &&
        caps.limitTotalUsd > 0 &&
        totalUsage >= caps.limitTotalUsd
      ) {
        return {
          allowed: false,
          window: "total",
          currentUsage: totalUsage,
          limitValue: caps.limitTotalUsd,
        };
      }

      return { allowed: true, failOpen };
    } catch (error) {
      logger.error("[BucketService] checkCostLimits failed, fail-open", {
        axis: bucket.axis,
        scopeId: bucket.scopeId,
        modelGroupId: bucket.modelGroupId,
        error,
      });
      return { allowed: true, failOpen: true };
    }
  }

  /** Decrement the lease budgets for a bucket after a request settles (total has no lease). */
  static async decrementLease(bucket: ModelLimitBucket, cost: number): Promise<void> {
    const { axis, scopeId, modelGroupId } = bucket;
    await Promise.all(
      leaseWindowSpecs(bucket)
        .filter((spec) => spec.limit && spec.limit > 0)
        .map((spec) =>
          BucketLeaseService.decrementLeaseBudget({
            axis,
            scopeId,
            modelGroupId,
            window: spec.window,
            cost,
            resetMode: spec.resetMode,
          })
        )
    );
  }
}
