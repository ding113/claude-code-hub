/**
 * Lease Service
 *
 * Implements lease-based budget slicing for rate limiting.
 * DB is authoritative, Redis stores lease slices.
 *
 * Key concepts:
 * - snapshotAtMs: Anchor point for window calculation (DB query timestamp)
 * - currentUsage: DB authoritative usage at snapshot time
 * - remainingBudget: Lease slice = min(limit * percent, remaining, capUsd)
 * - ttlSeconds: Lease refresh interval from system settings
 */

import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";
import {
  sumKeyCostInTimeRange,
  sumProviderCostInTimeRange,
  sumUserCostInTimeRange,
} from "@/repository/statistics";
import {
  type BudgetLease,
  buildLeaseKey,
  calculateLeaseSlice,
  createBudgetLease,
  deserializeLease,
  getLeaseTimeRange,
  isLeaseExpired,
  type LeaseEntityTypeType,
  type LeaseWindowType,
  serializeLease,
} from "./lease";
import type { DailyResetMode } from "./time-utils";

/**
 * Parameters for getting/refreshing a cost lease
 */
export interface GetCostLeaseParams {
  entityType: LeaseEntityTypeType;
  entityId: number;
  window: LeaseWindowType;
  limitAmount: number;
  resetTime?: string;
  resetMode?: DailyResetMode;
}

/**
 * Parameters for decrementing a lease budget
 */
export interface DecrementLeaseBudgetParams {
  entityType: LeaseEntityTypeType;
  entityId: number;
  window: LeaseWindowType;
  cost: number;
}

/**
 * Result of decrementing a lease budget
 */
export interface DecrementLeaseBudgetResult {
  success: boolean;
  newRemaining: number;
  failOpen?: boolean;
}

/**
 * Lease Service - manages budget leases for rate limiting
 */
export class LeaseService {
  private static get redis() {
    return getRedisClient();
  }

  /**
   * Get a cost lease for an entity/window combination
   *
   * 1. Try to get cached lease from Redis
   * 2. If valid (not expired), return it
   * 3. If missing or expired, refresh from DB
   * 4. If limitAmount changed, refresh from DB
   * 5. On error, fail-open (return null)
   */
  static async getCostLease(params: GetCostLeaseParams): Promise<BudgetLease | null> {
    const { entityType, entityId, window, limitAmount } = params;

    try {
      const redis = LeaseService.redis;
      const leaseKey = buildLeaseKey(entityType, entityId, window);

      // Try Redis cache first
      if (redis && redis.status === "ready") {
        const cached = await redis.get(leaseKey);

        if (cached) {
          const lease = deserializeLease(cached);

          if (lease && !isLeaseExpired(lease)) {
            // Check if limit changed - force refresh if so
            if (lease.limitAmount !== limitAmount) {
              logger.debug("[LeaseService] Limit changed, force refresh", {
                key: leaseKey,
                cachedLimit: lease.limitAmount,
                newLimit: limitAmount,
              });
              return await LeaseService.refreshCostLeaseFromDb(params);
            }

            logger.debug("[LeaseService] Cache hit", {
              key: leaseKey,
              remaining: lease.remainingBudget,
            });
            return lease;
          }
        }
      }

      // Cache miss or expired - refresh from DB
      return await LeaseService.refreshCostLeaseFromDb(params);
    } catch (error) {
      logger.error("[LeaseService] getCostLease failed, fail-open", {
        entityType,
        entityId,
        window,
        error,
      });
      return null;
    }
  }

  /**
   * Refresh a lease from the database
   *
   * 1. Get system settings for lease config
   * 2. Query DB for current usage in time window
   * 3. Calculate lease slice (min of percent, remaining, cap)
   * 4. Store in Redis with TTL
   * 5. Return the new lease
   */
  static async refreshCostLeaseFromDb(params: GetCostLeaseParams): Promise<BudgetLease | null> {
    const {
      entityType,
      entityId,
      window,
      limitAmount,
      resetTime = "00:00",
      resetMode = "fixed",
    } = params;

    try {
      // Get system settings
      const settings = await getCachedSystemSettings();
      const ttlSeconds = settings.quotaDbRefreshIntervalSeconds ?? 10;
      const capUsd = settings.quotaLeaseCapUsd ?? undefined;

      // Get percent based on window type
      const leasePercentConfig = {
        quotaLeasePercent5h: settings.quotaLeasePercent5h ?? 0.05,
        quotaLeasePercentDaily: settings.quotaLeasePercentDaily ?? 0.05,
        quotaLeasePercentWeekly: settings.quotaLeasePercentWeekly ?? 0.05,
        quotaLeasePercentMonthly: settings.quotaLeasePercentMonthly ?? 0.05,
      };
      const percent = LeaseService.getLeasePercent(window, leasePercentConfig);

      // Calculate time range for DB query
      const { startTime, endTime } = getLeaseTimeRange(window, resetTime, resetMode);

      // Query DB for current usage
      const currentUsage = await LeaseService.queryDbUsage(
        entityType,
        entityId,
        startTime,
        endTime
      );

      // Calculate lease slice
      const remainingBudget = calculateLeaseSlice({
        limitAmount,
        currentUsage,
        percent,
        capUsd,
      });

      // Create lease object
      const snapshotAtMs = Date.now();
      const lease = createBudgetLease({
        entityType,
        entityId,
        window,
        resetMode,
        resetTime,
        snapshotAtMs,
        currentUsage,
        limitAmount,
        remainingBudget,
        ttlSeconds,
      });

      // Store in Redis
      const redis = LeaseService.redis;
      if (redis && redis.status === "ready") {
        const leaseKey = buildLeaseKey(entityType, entityId, window);
        await redis.setex(leaseKey, ttlSeconds, serializeLease(lease));

        logger.debug("[LeaseService] Lease refreshed from DB", {
          key: leaseKey,
          currentUsage,
          remainingBudget,
          ttl: ttlSeconds,
        });
      }

      return lease;
    } catch (error) {
      logger.error("[LeaseService] refreshCostLeaseFromDb failed", {
        entityType,
        entityId,
        window,
        error,
      });
      return null;
    }
  }

  /**
   * Get the lease percent for a window type from system settings
   */
  private static getLeasePercent(
    window: LeaseWindowType,
    settings: {
      quotaLeasePercent5h: number;
      quotaLeasePercentDaily: number;
      quotaLeasePercentWeekly: number;
      quotaLeasePercentMonthly: number;
    }
  ): number {
    switch (window) {
      case "5h":
        return settings.quotaLeasePercent5h;
      case "daily":
        return settings.quotaLeasePercentDaily;
      case "weekly":
        return settings.quotaLeasePercentWeekly;
      case "monthly":
        return settings.quotaLeasePercentMonthly;
      default:
        return 0.05; // Default 5%
    }
  }

  /**
   * Query database for usage in a time range
   */
  private static async queryDbUsage(
    entityType: LeaseEntityTypeType,
    entityId: number,
    startTime: Date,
    endTime: Date
  ): Promise<number> {
    switch (entityType) {
      case "key":
        return await sumKeyCostInTimeRange(entityId, startTime, endTime);
      case "user":
        return await sumUserCostInTimeRange(entityId, startTime, endTime);
      case "provider":
        return await sumProviderCostInTimeRange(entityId, startTime, endTime);
      default:
        return 0;
    }
  }

  /**
   * Lua script for atomic lease budget decrement
   *
   * KEYS[1] = lease key
   * ARGV[1] = cost to decrement
   *
   * Returns: [newRemaining, success]
   * - success=1: decremented successfully
   * - success=0, newRemaining=0: insufficient budget
   * - success=0, newRemaining=-1: key not found
   */
  private static readonly DECREMENT_LUA_SCRIPT = `
    local key = KEYS[1]
    local cost = tonumber(ARGV[1])

    -- Get current lease JSON
    local leaseJson = redis.call('GET', key)
    if not leaseJson then
      return {-1, 0}
    end

    -- Parse lease JSON
    local lease = cjson.decode(leaseJson)
    local remaining = tonumber(lease.remainingBudget) or 0

    -- Check if budget is sufficient
    if remaining < cost then
      return {0, 0}
    end

    -- Decrement budget
    local newRemaining = remaining - cost
    lease.remainingBudget = newRemaining

    -- Get TTL and update lease
    local ttl = redis.call('TTL', key)
    if ttl > 0 then
      redis.call('SETEX', key, ttl, cjson.encode(lease))
    end

    return {newRemaining, 1}
  `;

  /**
   * Decrement lease budget atomically using Lua script
   *
   * Note: This uses Redis EVAL command to execute Lua scripts atomically.
   * This is NOT JavaScript eval() - it's a safe Redis operation for atomic updates.
   *
   * 1. Try to decrement budget in Redis atomically
   * 2. If successful, return new remaining budget
   * 3. If insufficient budget, return success=false
   * 4. On error or Redis not ready, fail-open (return success=true)
   */
  static async decrementLeaseBudget(
    params: DecrementLeaseBudgetParams
  ): Promise<DecrementLeaseBudgetResult> {
    const { entityType, entityId, window, cost } = params;

    try {
      const redis = LeaseService.redis;

      // Fail-open if Redis is not ready
      if (!redis || redis.status !== "ready") {
        logger.warn("[LeaseService] Redis not ready, fail-open for decrement", {
          entityType,
          entityId,
          window,
          cost,
        });
        return { success: true, newRemaining: -1, failOpen: true };
      }

      const leaseKey = buildLeaseKey(entityType, entityId, window);

      // Execute Lua script atomically using Redis EVAL command
      const result = (await redis.eval(LeaseService.DECREMENT_LUA_SCRIPT, 1, leaseKey, cost)) as [
        number,
        number,
      ];

      const [newRemaining, success] = result;

      if (success === 1) {
        logger.debug("[LeaseService] Budget decremented", {
          key: leaseKey,
          cost,
          newRemaining,
        });
        return { success: true, newRemaining };
      }

      // Key not found or insufficient budget
      logger.debug("[LeaseService] Decrement failed", {
        key: leaseKey,
        cost,
        newRemaining,
        reason: newRemaining === -1 ? "key_not_found" : "insufficient_budget",
      });
      return { success: false, newRemaining };
    } catch (error) {
      // Fail-open on any error
      logger.error("[LeaseService] decrementLeaseBudget failed, fail-open", {
        entityType,
        entityId,
        window,
        cost,
        error,
      });
      return { success: true, newRemaining: -1, failOpen: true };
    }
  }
}
