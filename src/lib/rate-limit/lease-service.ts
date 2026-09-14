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
  sumEntityCostInTimeRanges,
  sumKeyCostInTimeRange,
  sumProviderCostInTimeRange,
  sumUserCostInTimeRange,
} from "@/repository/statistics";
import {
  type BudgetLease,
  buildLeaseKey,
  buildLeaseRefreshLockKey,
  calculateLeaseSlice,
  createBudgetLease,
  deserializeLease,
  getLeaseTimeRange,
  isLeaseExpired,
  LEASE_REFRESH_LOCK_TTL_SECONDS,
  LEASE_REFRESH_POLL_MS,
  LEASE_REFRESH_WAIT_MS,
  LEASE_STALE_GRACE_SECONDS,
  type LeaseEntityTypeType,
  type LeaseWindowType,
  resolveLeaseTtlSeconds,
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
 * Result of validating a cached lease against the caller's current limits.
 * - lease: usable as-is
 * - stale: expired only by TTL (limits unchanged); usable while another process refreshes
 */
interface CachedLeaseValidation {
  lease: BudgetLease | null;
  stale: BudgetLease | null;
}

type LeaseBatch = Array<BudgetLease | null>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lease Service - manages budget leases for rate limiting
 */
export class LeaseService {
  private static readonly SETTLEMENT_MARKER_TTL_SECONDS = 5 * 60;

  private static readonly SETTLEMENT_ENTITY_TYPES = ["key", "user", "provider"] as const;

  private static readonly SETTLEMENT_WINDOWS = ["5h", "daily", "weekly", "monthly"] as const;

  /** In-process single-flight for batched refreshes, keyed by entity and window signature. */
  private static readonly inFlightRefreshes = new Map<string, Promise<LeaseBatch>>();

  private static get redis() {
    return getRedisClient();
  }

  /**
   * Apply the lease reuse rules (TTL, fixed 5h reset, limit and cost reset changes) to a cached
   * Redis value.
   */
  private static validateCachedLease(
    cached: string | null | undefined,
    params: GetCostLeaseParams
  ): CachedLeaseValidation {
    if (!cached) return { lease: null, stale: null };
    const lease = deserializeLease(cached);
    if (!lease) return { lease: null, stale: null };

    if (
      lease.window === "5h" &&
      lease.resetMode === "fixed" &&
      typeof lease.windowResetAtMs === "number" &&
      lease.windowResetAtMs <= Date.now()
    ) {
      return { lease: null, stale: null };
    }
    if (lease.limitAmount !== params.limitAmount) {
      return { lease: null, stale: null };
    }
    const paramResetAtMs = params.costResetAt instanceof Date ? params.costResetAt.getTime() : null;
    if ((lease.costResetAtMs ?? null) !== paramResetAtMs) {
      return { lease: null, stale: null };
    }
    if (isLeaseExpired(lease)) {
      return { lease: null, stale: lease };
    }
    return { lease, stale: null };
  }

  private static buildRefreshSignature(
    entityType: LeaseEntityTypeType,
    entityId: number,
    windows: GetCostLeaseParams[]
  ): string {
    const parts = windows.map((params) => {
      const resetAtMs = params.costResetAt instanceof Date ? params.costResetAt.getTime() : "";
      return [
        params.window,
        params.resetMode ?? "",
        params.resetTime ?? "",
        params.limitAmount,
        resetAtMs,
      ].join(":");
    });
    return `${entityType}:${entityId}|${parts.join("|")}`;
  }

  /**
   * Get leases for several windows of one entity with at most one usage_ledger scan.
   *
   * 1. Read all window leases with one MGET
   * 2. Windows whose cached lease is still valid are returned as-is
   * 3. The remaining windows are refreshed together through a single-flight refresh (in-process
   *    promise sharing plus a cross-process Redis lock); while another process refreshes, expired
   *    leases are served instead of issuing duplicate aggregations
   * 4. Any failure fails open (null) for the affected windows, matching getCostLease
   */
  static async getCostLeases(
    entityType: LeaseEntityTypeType,
    entityId: number,
    windows: GetCostLeaseParams[]
  ): Promise<LeaseBatch> {
    if (windows.length === 0) return [];

    try {
      const results: LeaseBatch = windows.map(() => null);
      const staleLeases: LeaseBatch = windows.map(() => null);
      const refreshIndexes: number[] = [];

      const redis = LeaseService.redis;
      if (redis && redis.status === "ready") {
        const cachedValues = await redis.mget(
          ...windows.map((params) =>
            buildLeaseKey(params.entityType, params.entityId, params.window, params.resetMode)
          )
        );
        windows.forEach((params, index) => {
          const validation = LeaseService.validateCachedLease(cachedValues[index], params);
          if (validation.lease) {
            results[index] = validation.lease;
          } else {
            staleLeases[index] = validation.stale;
            refreshIndexes.push(index);
          }
        });
      } else {
        refreshIndexes.push(...windows.map((_, index) => index));
      }

      if (refreshIndexes.length === 0) {
        return results;
      }

      const refreshed = await LeaseService.refreshCostLeasesSingleFlight(
        entityType,
        entityId,
        refreshIndexes.map((index) => windows[index]),
        refreshIndexes.map((index) => staleLeases[index])
      );
      refreshIndexes.forEach((windowIndex, refreshIndex) => {
        results[windowIndex] = refreshed[refreshIndex] ?? null;
      });
      return results;
    } catch (error) {
      logger.error("[LeaseService] getCostLeases failed, fail-open", {
        entityType,
        entityId,
        windows: windows.map((params) => params.window),
        error,
      });
      return windows.map(() => null);
    }
  }

  private static async refreshCostLeasesSingleFlight(
    entityType: LeaseEntityTypeType,
    entityId: number,
    windows: GetCostLeaseParams[],
    staleLeases: LeaseBatch
  ): Promise<LeaseBatch> {
    const signature = LeaseService.buildRefreshSignature(entityType, entityId, windows);
    const allStale = staleLeases.every((lease) => lease !== null);

    const existing = LeaseService.inFlightRefreshes.get(signature);
    if (existing) {
      return allStale ? staleLeases : existing;
    }

    const refresh = LeaseService.refreshCostLeasesWithLock(
      entityType,
      entityId,
      windows,
      staleLeases
    ).finally(() => {
      if (LeaseService.inFlightRefreshes.get(signature) === refresh) {
        LeaseService.inFlightRefreshes.delete(signature);
      }
    });
    LeaseService.inFlightRefreshes.set(signature, refresh);
    return refresh;
  }

  private static async refreshCostLeasesWithLock(
    entityType: LeaseEntityTypeType,
    entityId: number,
    windows: GetCostLeaseParams[],
    staleLeases: LeaseBatch
  ): Promise<LeaseBatch> {
    const redis = LeaseService.redis;
    if (redis?.status !== "ready" || !redis) {
      return LeaseService.refreshCostLeasesFromDb(entityType, entityId, windows);
    }

    const lockKey = buildLeaseRefreshLockKey(entityType, entityId);
    let acquired = false;
    try {
      acquired =
        (await redis.set(lockKey, "1", "EX", LEASE_REFRESH_LOCK_TTL_SECONDS, "NX")) === "OK";
    } catch (error) {
      logger.warn("[LeaseService] Refresh lock unavailable, refreshing directly", {
        entityType,
        entityId,
        error,
      });
      return LeaseService.refreshCostLeasesFromDb(entityType, entityId, windows);
    }

    if (acquired) {
      try {
        return await LeaseService.refreshCostLeasesFromDb(entityType, entityId, windows);
      } finally {
        await Promise.resolve()
          .then(() => redis.del(lockKey))
          .catch((error: unknown) => {
            logger.warn("[LeaseService] Failed to release refresh lock", { lockKey, error });
          });
      }
    }

    // Another process is refreshing this entity. Expired leases never grant new budget, so serving
    // them avoids a duplicate aggregation without widening the over-spend bound.
    if (staleLeases.every((lease) => lease !== null)) {
      logger.debug("[LeaseService] Refresh lock held elsewhere, serving expired leases", {
        entityType,
        entityId,
      });
      return staleLeases;
    }

    const leaseKeys = windows.map((params) =>
      buildLeaseKey(params.entityType, params.entityId, params.window, params.resetMode)
    );
    const deadline = Date.now() + LEASE_REFRESH_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(LEASE_REFRESH_POLL_MS);
      const cachedValues = await redis.mget(...leaseKeys);
      const fresh = windows.map(
        (params, index) => LeaseService.validateCachedLease(cachedValues[index], params).lease
      );
      if (fresh.every((lease) => lease !== null)) {
        return fresh;
      }
    }

    logger.debug("[LeaseService] Timed out waiting for concurrent refresh, refreshing directly", {
      entityType,
      entityId,
    });
    return LeaseService.refreshCostLeasesFromDb(entityType, entityId, windows);
  }

  /**
   * Refresh several windows of one entity from the database.
   *
   * Fixed 5h windows are read from Redis. All other windows share one usage_ledger scan (a single
   * window keeps using the dedicated per-window query). Leases are stored with a stale grace so
   * that concurrent callers can serve them while a later refresh is in progress.
   */
  static async refreshCostLeasesFromDb(
    entityType: LeaseEntityTypeType,
    entityId: number,
    windows: GetCostLeaseParams[]
  ): Promise<LeaseBatch> {
    if (windows.length === 0) return [];

    try {
      const settings = await getCachedSystemSettings();
      const ttlSeconds = resolveLeaseTtlSeconds(
        settings.quotaDbRefreshIntervalSeconds,
        settings.enableHighConcurrencyMode === true
      );
      const capUsd = settings.quotaLeaseCapUsd ?? undefined;
      const leasePercentConfig = {
        quotaLeasePercent5h: settings.quotaLeasePercent5h ?? 0.05,
        quotaLeasePercentDaily: settings.quotaLeasePercentDaily ?? 0.05,
        quotaLeasePercentWeekly: settings.quotaLeasePercentWeekly ?? 0.05,
        quotaLeasePercentMonthly: settings.quotaLeasePercentMonthly ?? 0.05,
      };

      const usages: number[] = windows.map(() => 0);
      const windowResets: Array<number | null> = windows.map(() => null);
      const dbIndexes: number[] = [];
      const dbRanges: Array<{ startTime: Date; endTime: Date }> = [];

      for (const [index, params] of windows.entries()) {
        const resetMode = params.resetMode ?? "fixed";
        if (params.window === "5h" && resetMode === "fixed") {
          const fixedWindowState = await LeaseService.readFixed5hWindowState(entityType, entityId);
          usages[index] = fixedWindowState.currentUsage;
          windowResets[index] = fixedWindowState.windowResetAtMs;
          continue;
        }

        const { startTime, endTime } = await getLeaseTimeRange(
          params.window,
          params.resetTime ?? "00:00",
          resetMode
        );
        const effectiveStartTime =
          params.costResetAt instanceof Date && params.costResetAt > startTime
            ? params.costResetAt
            : startTime;
        dbIndexes.push(index);
        dbRanges.push({ startTime: effectiveStartTime, endTime });
      }

      if (dbIndexes.length === 1) {
        usages[dbIndexes[0]] = await LeaseService.queryDbUsage(
          entityType,
          entityId,
          dbRanges[0].startTime,
          dbRanges[0].endTime
        );
      } else if (dbIndexes.length > 1) {
        const sums = await sumEntityCostInTimeRanges(entityType, entityId, dbRanges);
        dbIndexes.forEach((windowIndex, rangeIndex) => {
          usages[windowIndex] = sums[rangeIndex] ?? 0;
        });
      }

      const snapshotAtMs = Date.now();
      const leases = windows.map((params, index) => {
        const resetMode = params.resetMode ?? "fixed";
        return createBudgetLease({
          entityType,
          entityId,
          window: params.window,
          resetMode,
          resetTime: params.resetTime ?? "00:00",
          snapshotAtMs,
          currentUsage: usages[index],
          limitAmount: params.limitAmount,
          remainingBudget: calculateLeaseSlice({
            limitAmount: params.limitAmount,
            currentUsage: usages[index],
            percent: LeaseService.getLeasePercent(params.window, leasePercentConfig),
            capUsd,
          }),
          ttlSeconds,
          costResetAtMs: params.costResetAt instanceof Date ? params.costResetAt.getTime() : null,
          windowResetAtMs: windowResets[index],
        });
      });

      const redis = LeaseService.redis;
      if (redis && redis.status === "ready") {
        const storageTtlSeconds = ttlSeconds + LEASE_STALE_GRACE_SECONDS;
        if (leases.length === 1) {
          const lease = leases[0];
          await redis.setex(
            buildLeaseKey(entityType, entityId, lease.window, lease.resetMode),
            storageTtlSeconds,
            serializeLease(lease)
          );
        } else {
          const pipeline = redis.pipeline();
          for (const lease of leases) {
            pipeline.setex(
              buildLeaseKey(entityType, entityId, lease.window, lease.resetMode),
              storageTtlSeconds,
              serializeLease(lease)
            );
          }
          await pipeline.exec();
        }
        logger.debug("[LeaseService] Leases refreshed from DB", {
          entityType,
          entityId,
          windows: leases.map((lease) => lease.window),
          ttl: ttlSeconds,
        });
      }

      return leases;
    } catch (error) {
      logger.error("[LeaseService] refreshCostLeasesFromDb failed", {
        entityType,
        entityId,
        windows: windows.map((params) => params.window),
        error,
      });
      return windows.map(() => null);
    }
  }

  private static getFixed5hCostKey(entityType: LeaseEntityTypeType, entityId: number): string {
    return `${entityType}:${entityId}:cost_5h_fixed`;
  }

  private static async readFixed5hWindowState(
    entityType: LeaseEntityTypeType,
    entityId: number
  ): Promise<{ currentUsage: number; windowResetAtMs: number | null }> {
    const redis = LeaseService.redis;
    if (redis?.status !== "ready") {
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
    const { entityType, entityId, window } = params;

    try {
      const redis = LeaseService.redis;
      const leaseKey = buildLeaseKey(entityType, entityId, window, params.resetMode);

      // Try Redis cache first
      if (redis && redis.status === "ready") {
        const cached = await redis.get(leaseKey);
        const validation = LeaseService.validateCachedLease(cached, params);
        if (validation.lease) {
          logger.debug("[LeaseService] Cache hit", {
            key: leaseKey,
            remaining: validation.lease.remainingBudget,
          });
          return validation.lease;
        }
      }

      // Cache miss, expired, or limits changed - refresh from DB
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
   * Refresh a single lease from the database (see refreshCostLeasesFromDb).
   */
  static async refreshCostLeaseFromDb(params: GetCostLeaseParams): Promise<BudgetLease | null> {
    const [lease] = await LeaseService.refreshCostLeasesFromDb(params.entityType, params.entityId, [
      params,
    ]);
    return lease ?? null;
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
      if (redis?.status !== "ready") {
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
