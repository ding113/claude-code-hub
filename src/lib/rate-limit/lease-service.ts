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
  costResetAt?: Date | null;
}

/**
 * Parameters for decrementing a lease budget
 */
export interface DecrementLeaseBudgetParams {
  entityType: LeaseEntityTypeType;
  entityId: number;
  window: LeaseWindowType;
  cost: number;
  resetMode?: DailyResetMode;
}

/**
 * Result of decrementing a lease budget
 */
export interface DecrementLeaseBudgetResult {
  success: boolean;
  newRemaining: number;
  failOpen?: boolean;
}

export interface LeaseSettlementEntity {
  id: number;
  resetModes?: Partial<Record<"5h" | "daily", DailyResetMode>>;
}

export interface SettleLeaseBudgetsParams {
  requestId: string | number;
  cost: number;
  entities: {
    key: LeaseSettlementEntity;
    user: LeaseSettlementEntity;
    provider: LeaseSettlementEntity;
  };
}

export type LeaseBudgetSettlementStatus = "decremented" | "missing" | "insufficient";

export interface LeaseBudgetSettlement {
  entityType: LeaseEntityTypeType;
  entityId: number;
  window: LeaseWindowType;
  status: LeaseBudgetSettlementStatus;
  newRemaining: number;
}

export interface SettleLeaseBudgetsResult {
  requestId: string;
  status: "settled" | "duplicate" | "fail_open";
  settlements: LeaseBudgetSettlement[];
  failOpen?: boolean;
}

interface LeaseSettlementTarget {
  entityType: LeaseEntityTypeType;
  entityId: number;
  window: LeaseWindowType;
  resetMode?: DailyResetMode;
}

/**
 * Lease Service - manages budget leases for rate limiting
 */
export class LeaseService {
  private static readonly SETTLEMENT_MARKER_TTL_SECONDS = 5 * 60;

  private static readonly SETTLEMENT_ENTITY_TYPES = ["key", "user", "provider"] as const;

  private static readonly SETTLEMENT_WINDOWS = ["5h", "daily", "weekly", "monthly"] as const;

  private static get redis() {
    return getRedisClient();
  }

  private static getFixed5hCostKey(entityType: LeaseEntityTypeType, entityId: number): string {
    return `${entityType}:${entityId}:cost_5h_fixed`;
  }

  private static async readFixed5hWindowState(
    entityType: LeaseEntityTypeType,
    entityId: number
  ): Promise<{ currentUsage: number; windowResetAtMs: number | null }> {
    const redis = LeaseService.redis;
    if (!redis || redis.status !== "ready") {
      throw new Error("Redis not ready for fixed 5h lease refresh");
    }

    const key = LeaseService.getFixed5hCostKey(entityType, entityId);
    const [value, ttlSecondsRaw] = await Promise.all([redis.get(key), redis.ttl(key)]);

    if (value === null) {
      return { currentUsage: 0, windowResetAtMs: null };
    }

    const currentUsage = Number.parseFloat(value || "0");
    const ttlSeconds = typeof ttlSecondsRaw === "number" ? ttlSecondsRaw : Number(ttlSecondsRaw);
    const windowResetAtMs =
      Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;

    return {
      currentUsage: Number.isFinite(currentUsage) ? currentUsage : 0,
      windowResetAtMs,
    };
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
      const leaseKey = buildLeaseKey(entityType, entityId, window, params.resetMode);

      // Try Redis cache first
      if (redis && redis.status === "ready") {
        const cached = await redis.get(leaseKey);

        if (cached) {
          const lease = deserializeLease(cached);

          if (lease && !isLeaseExpired(lease)) {
            if (
              lease.window === "5h" &&
              lease.resetMode === "fixed" &&
              typeof lease.windowResetAtMs === "number" &&
              lease.windowResetAtMs <= Date.now()
            ) {
              logger.debug("[LeaseService] Fixed 5h window already reset, force refresh", {
                key: leaseKey,
                windowResetAtMs: lease.windowResetAtMs,
              });
              return await LeaseService.refreshCostLeaseFromDb(params);
            }

            // Check if limit changed - force refresh if so
            if (lease.limitAmount !== limitAmount) {
              logger.debug("[LeaseService] Limit changed, force refresh", {
                key: leaseKey,
                cachedLimit: lease.limitAmount,
                newLimit: limitAmount,
              });
              return await LeaseService.refreshCostLeaseFromDb(params);
            }

            // Check if costResetAt changed - force refresh if so
            const paramResetAtMs =
              params.costResetAt instanceof Date ? params.costResetAt.getTime() : null;
            if ((lease.costResetAtMs ?? null) !== paramResetAtMs) {
              logger.debug("[LeaseService] costResetAt changed, force refresh", {
                key: leaseKey,
                cachedResetAtMs: lease.costResetAtMs ?? null,
                newResetAtMs: paramResetAtMs,
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

      let currentUsage = 0;
      let windowResetAtMs: number | null = null;

      if (window === "5h" && resetMode === "fixed") {
        const fixedWindowState = await LeaseService.readFixed5hWindowState(entityType, entityId);
        currentUsage = fixedWindowState.currentUsage;
        windowResetAtMs = fixedWindowState.windowResetAtMs;
      } else {
        // Calculate time range for DB query
        const { startTime, endTime } = await getLeaseTimeRange(window, resetTime, resetMode);

        // Clip startTime forward if costResetAt is more recent (limits-only reset)
        const effectiveStartTime =
          params.costResetAt instanceof Date && params.costResetAt > startTime
            ? params.costResetAt
            : startTime;

        // Query DB for current usage
        currentUsage = await LeaseService.queryDbUsage(
          entityType,
          entityId,
          effectiveStartTime,
          endTime
        );
      }

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
        costResetAtMs: params.costResetAt instanceof Date ? params.costResetAt.getTime() : null,
        windowResetAtMs,
      });

      // Store in Redis
      const redis = LeaseService.redis;
      if (redis && redis.status === "ready") {
        const leaseKey = buildLeaseKey(entityType, entityId, window, resetMode);
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
   * Atomically settle the fixed 4 windows x 3 entity lease set.
   *
   * KEYS[1] is a bounded idempotency marker. KEYS[2..13] are the lease keys in
   * key/user/provider then 5h/daily/weekly/monthly order. ARGV[1] is the actual
   * cost and ARGV[2] is the marker TTL in seconds.
   *
   * The marker survives the Redis client's bounded reconnect retry cycle while
   * expiring after five minutes so marker cardinality remains bounded.
   */
  private static readonly SETTLE_LEASE_BUDGETS_LUA_SCRIPT = `
    local markerKey = KEYS[1]
    local previousSettlement = redis.call("GET", markerKey)
    if previousSettlement then
      return {1, previousSettlement}
    end

    local cost = tonumber(ARGV[1])
    local markerTtlSeconds = tonumber(ARGV[2])
    local settlements = {}
    local pendingWrites = {}

    for keyIndex = 2, #KEYS do
      local leaseKey = KEYS[keyIndex]
      local leaseReply = redis.pcall("GET", leaseKey)
      local leaseReadFailed = type(leaseReply) == "table" and leaseReply.err

      if leaseReadFailed or not leaseReply then
        settlements[#settlements + 1] = {0, -1}
      else
        local decoded, lease = pcall(cjson.decode, leaseReply)
        local remaining = nil
        if decoded and type(lease) == "table" then
          remaining = tonumber(lease.remainingBudget)
        end
        local ttl = redis.call("TTL", leaseKey)

        if not remaining or ttl <= 0 then
          settlements[#settlements + 1] = {0, -1}
        elseif remaining < cost then
          -- Consume the cached slice when the request is larger than the
          -- remaining lease. Keeping a positive balance here lets every
          -- request in the refresh window repeat the same overshoot.
          lease.remainingBudget = 0
          local encodedLeaseOk, encodedLease = pcall(cjson.encode, lease)
          if not encodedLeaseOk then
            settlements[#settlements + 1] = {0, -1}
          else
            pendingWrites[#pendingWrites + 1] = {leaseKey, ttl, encodedLease}
            settlements[#settlements + 1] = {-1, 0}
          end
        else
          local newRemaining = remaining - cost
          lease.remainingBudget = newRemaining
          local encodedLeaseOk, encodedLease = pcall(cjson.encode, lease)
          if not encodedLeaseOk then
            settlements[#settlements + 1] = {0, -1}
          else
            pendingWrites[#pendingWrites + 1] = {leaseKey, ttl, encodedLease}
            settlements[#settlements + 1] = {1, newRemaining}
          end
        end
      end
    end

    local encodedOk, encoded = pcall(cjson.encode, settlements)
    if not encodedOk then
      return redis.error_reply("failed to encode lease settlement results")
    end

    for writeIndex = 1, #pendingWrites do
      local pendingWrite = pendingWrites[writeIndex]
      redis.call("SETEX", pendingWrite[1], pendingWrite[2], pendingWrite[3])
    end

    redis.call("SETEX", markerKey, markerTtlSeconds, encoded)
    return {0, encoded}
  `;

  private static buildSettlementTargets(params: SettleLeaseBudgetsParams): LeaseSettlementTarget[] {
    const targets: LeaseSettlementTarget[] = [];

    for (const entityType of LeaseService.SETTLEMENT_ENTITY_TYPES) {
      const entity = params.entities[entityType];

      for (const window of LeaseService.SETTLEMENT_WINDOWS) {
        targets.push({
          entityType,
          entityId: entity.id,
          window,
          resetMode:
            window === "5h" || window === "daily" ? entity.resetModes?.[window] : undefined,
        });
      }
    }

    return targets;
  }

  private static parseSettlementResults(
    rawSettlements: unknown,
    targets: LeaseSettlementTarget[]
  ): LeaseBudgetSettlement[] {
    if (typeof rawSettlements !== "string") {
      throw new Error("Invalid lease settlement payload");
    }

    const parsed = JSON.parse(rawSettlements) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== targets.length) {
      throw new Error("Invalid lease settlement result count");
    }

    return targets.map((target, index) => {
      const rawResult = parsed[index];
      if (!Array.isArray(rawResult) || rawResult.length !== 2) {
        throw new Error("Invalid lease settlement item");
      }

      const statusCode = Number(rawResult[0]);
      const newRemaining = Number(rawResult[1]);
      if (!Number.isFinite(newRemaining)) {
        throw new Error("Invalid lease settlement remaining budget");
      }

      let status: LeaseBudgetSettlementStatus;
      if (statusCode === 1) {
        status = "decremented";
      } else if (statusCode === 0) {
        status = "missing";
      } else if (statusCode === -1) {
        status = "insufficient";
      } else {
        throw new Error("Invalid lease settlement status");
      }

      return {
        entityType: target.entityType,
        entityId: target.entityId,
        window: target.window,
        status,
        newRemaining,
      };
    });
  }

  /**
   * Settle one request's actual cost against all twelve lease budgets.
   *
   * A request marker and all lease mutations run in one bounded Lua invocation.
   * If ioredis resends a command after losing the first reply, the marker returns
   * the original result without applying the cost again.
   */
  static async settleLeaseBudgets(
    params: SettleLeaseBudgetsParams
  ): Promise<SettleLeaseBudgetsResult> {
    const requestId = String(params.requestId).trim();

    try {
      const redis = LeaseService.redis;
      if (redis?.status !== "ready") {
        logger.warn("[LeaseService] Redis not ready, fail-open for batch settlement", {
          requestId,
          cost: params.cost,
        });
        return { requestId, status: "fail_open", settlements: [], failOpen: true };
      }

      if (!requestId || !Number.isFinite(params.cost) || params.cost <= 0) {
        logger.warn("[LeaseService] Invalid batch settlement input, fail-open", {
          requestId,
          cost: params.cost,
        });
        return { requestId, status: "fail_open", settlements: [], failOpen: true };
      }

      const targets = LeaseService.buildSettlementTargets(params);
      const markerKey = `lease:settlement:${requestId}`;
      const leaseKeys = targets.map((target) =>
        buildLeaseKey(target.entityType, target.entityId, target.window, target.resetMode)
      );

      const rawResult = (await redis.eval(
        LeaseService.SETTLE_LEASE_BUDGETS_LUA_SCRIPT,
        1 + leaseKeys.length,
        markerKey,
        ...leaseKeys,
        params.cost.toString(),
        LeaseService.SETTLEMENT_MARKER_TTL_SECONDS.toString()
      )) as unknown;

      if (!Array.isArray(rawResult) || rawResult.length !== 2) {
        throw new Error("Invalid lease settlement response");
      }

      const duplicateFlag = Number(rawResult[0]);
      if (duplicateFlag !== 0 && duplicateFlag !== 1) {
        throw new Error("Invalid lease settlement duplicate flag");
      }

      const settlements = LeaseService.parseSettlementResults(rawResult[1], targets);
      const status = duplicateFlag === 1 ? "duplicate" : "settled";

      logger.debug("[LeaseService] Batch lease settlement completed", {
        requestId,
        status,
        cost: params.cost,
      });

      return { requestId, status, settlements };
    } catch (error) {
      logger.error("[LeaseService] settleLeaseBudgets failed, fail-open", {
        requestId,
        cost: params.cost,
        error,
      });
      return { requestId, status: "fail_open", settlements: [], failOpen: true };
    }
  }

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
    const { entityType, entityId, window, cost, resetMode } = params;

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

      const leaseKey = buildLeaseKey(entityType, entityId, window, resetMode);

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
