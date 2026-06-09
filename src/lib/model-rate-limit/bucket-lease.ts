/**
 * Bucket Lease Service (group-rate-limit §6).
 *
 * Per-(axis, scope, model group, window) replica of the mainline LeaseService.
 * DB (usage_ledger) is authoritative; Redis stores lease slices keyed under
 * lease:user-mg: / lease:key-mg:. Usage is aggregated across the group's member
 * models (model IN (...)). OPT-B lets model buckets use a dedicated percent and a
 * slice floor so small budgets don't thrash the DB. The atomic decrement is
 * delegated to ModelLeaseService (shared Redis Lua) via a lease key override.
 */

import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { logger } from "@/lib/logger";
import {
  type BudgetLease,
  calculateLeaseSlice,
  createBudgetLease,
  deserializeLease,
  getLeaseTimeRange,
  getLeaseTtlSeconds,
  isLeaseExpired,
  type LeaseWindowType,
  serializeLease,
} from "@/lib/rate-limit/lease";
import type { DailyResetMode } from "@/lib/rate-limit/time-utils";
import { getRedisClient } from "@/lib/redis";
import { sumScopeCostByModelsInTimeRange } from "@/repository/statistics";
import { buildModelGroupLeaseKey, type ModelScopeType } from "./keys";
import { type DecrementModelLeaseResult, ModelLeaseService } from "./lease";

export interface BucketLeaseParams {
  axis: ModelScopeType;
  scopeId: number;
  modelGroupId: number;
  models: string[];
  window: LeaseWindowType;
  limitAmount: number;
  resetTime?: string;
  resetMode?: DailyResetMode;
  costResetAt?: Date | null;
}

export interface DecrementBucketLeaseParams {
  axis: ModelScopeType;
  scopeId: number;
  modelGroupId: number;
  window: LeaseWindowType;
  cost: number;
  resetMode?: DailyResetMode;
}

interface ModelLeaseSettings {
  quotaModelLeasePercent5h?: number | null;
  quotaModelLeasePercentDaily?: number | null;
  quotaModelLeasePercentWeekly?: number | null;
  quotaModelLeasePercentMonthly?: number | null;
  quotaModelLeaseMinSliceUsd?: number | null;
  quotaLeasePercent5h?: number | null;
  quotaLeasePercentDaily?: number | null;
  quotaLeasePercentWeekly?: number | null;
  quotaLeasePercentMonthly?: number | null;
}

/** Model-dimension percent: dedicated OPT-B value, else global, else 5%. */
export function getModelLeasePercent(
  window: LeaseWindowType,
  settings: ModelLeaseSettings
): number {
  switch (window) {
    case "5h":
      return settings.quotaModelLeasePercent5h ?? settings.quotaLeasePercent5h ?? 0.05;
    case "daily":
      return settings.quotaModelLeasePercentDaily ?? settings.quotaLeasePercentDaily ?? 0.05;
    case "weekly":
      return settings.quotaModelLeasePercentWeekly ?? settings.quotaLeasePercentWeekly ?? 0.05;
    case "monthly":
      return settings.quotaModelLeasePercentMonthly ?? settings.quotaLeasePercentMonthly ?? 0.05;
    default:
      return 0.05;
  }
}

export class BucketLeaseService {
  private static get redis() {
    return getRedisClient();
  }

  static async getCostLease(params: BucketLeaseParams): Promise<BudgetLease | null> {
    const { axis, scopeId, modelGroupId, window, limitAmount } = params;
    try {
      const redis = BucketLeaseService.redis;
      const leaseKey = buildModelGroupLeaseKey(
        axis,
        scopeId,
        modelGroupId,
        window,
        params.resetMode
      );

      if (redis && redis.status === "ready") {
        const cached = await redis.get(leaseKey);
        if (cached) {
          const lease = deserializeLease(cached);
          if (lease && !isLeaseExpired(lease) && lease.limitAmount === limitAmount) {
            return lease;
          }
        }
      }

      return await BucketLeaseService.refreshCostLeaseFromDb(params);
    } catch (error) {
      logger.error("[BucketLease] getCostLease failed, fail-open", {
        axis,
        scopeId,
        modelGroupId,
        window,
        error,
      });
      return null;
    }
  }

  static async refreshCostLeaseFromDb(params: BucketLeaseParams): Promise<BudgetLease | null> {
    const {
      axis,
      scopeId,
      modelGroupId,
      models,
      window,
      limitAmount,
      resetTime = "00:00",
      resetMode = "fixed",
    } = params;

    try {
      const settings = await getCachedSystemSettings();
      const ttlSeconds = settings.quotaDbRefreshIntervalSeconds ?? 10;
      const capUsd = settings.quotaLeaseCapUsd ?? undefined;
      const minSliceUsd = settings.quotaModelLeaseMinSliceUsd ?? undefined;
      const percent = getModelLeasePercent(window, settings);

      const { startTime, endTime } = await getLeaseTimeRange(window, resetTime, resetMode);
      const effectiveStartTime =
        params.costResetAt instanceof Date && params.costResetAt > startTime
          ? params.costResetAt
          : startTime;

      const currentUsage = await sumScopeCostByModelsInTimeRange(
        axis,
        scopeId,
        models,
        effectiveStartTime,
        endTime
      );

      const remainingBudget = calculateLeaseSlice({
        limitAmount,
        currentUsage,
        percent,
        capUsd,
        minSliceUsd,
      });

      const lease = createBudgetLease({
        entityType: axis,
        entityId: scopeId,
        window,
        resetMode,
        resetTime,
        snapshotAtMs: Date.now(),
        currentUsage,
        limitAmount,
        remainingBudget,
        ttlSeconds,
        costResetAtMs: params.costResetAt instanceof Date ? params.costResetAt.getTime() : null,
      });

      const redis = BucketLeaseService.redis;
      if (redis && redis.status === "ready") {
        const leaseKey = buildModelGroupLeaseKey(axis, scopeId, modelGroupId, window, resetMode);
        const effectiveTtl =
          ttlSeconds > 0 ? ttlSeconds : await getLeaseTtlSeconds(window, resetTime, resetMode);
        await redis.setex(leaseKey, effectiveTtl, serializeLease(lease));
      }

      return lease;
    } catch (error) {
      logger.error("[BucketLease] refreshCostLeaseFromDb failed", {
        axis,
        scopeId,
        modelGroupId,
        window,
        error,
      });
      return null;
    }
  }

  static async decrementLeaseBudget(
    params: DecrementBucketLeaseParams
  ): Promise<DecrementModelLeaseResult> {
    const { axis, scopeId, modelGroupId, window, cost, resetMode } = params;
    const leaseKey = buildModelGroupLeaseKey(axis, scopeId, modelGroupId, window, resetMode);
    // Reuse the shared atomic Redis decrement via a lease key override.
    return ModelLeaseService.decrementLeaseBudget({
      scopeType: axis,
      scopeId,
      model: "",
      window,
      cost,
      resetMode,
      leaseKeyOverride: leaseKey,
    });
  }
}
