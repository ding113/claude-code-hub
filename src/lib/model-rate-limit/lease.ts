/**
 * Shared atomic lease decrement for the group-rate-limit model buckets.
 *
 * The full per-model lease seeding/refresh was replaced by BucketLeaseService
 * (bucket-lease.ts), which delegates its atomic Redis decrement here via a
 * lease key override so the server-side Lua lives in one place.
 */

import { logger } from "@/lib/logger";
import type { LeaseWindowType } from "@/lib/rate-limit/lease";
import type { DailyResetMode } from "@/lib/rate-limit/time-utils";
import { getRedisClient } from "@/lib/redis";
import { buildModelLeaseKey, type ModelScopeType } from "./keys";

export interface DecrementModelLeaseParams {
  scopeType: ModelScopeType;
  scopeId: number;
  model: string;
  window: LeaseWindowType;
  cost: number;
  resetMode?: DailyResetMode;
  /**
   * Precomputed lease key. When set, it is used verbatim and `model` is ignored.
   * Lets the group-based BucketLeaseService reuse this atomic decrement with a
   * lease:user-mg / lease:key-mg key.
   */
  leaseKeyOverride?: string;
}

export interface DecrementModelLeaseResult {
  success: boolean;
  newRemaining: number;
  failOpen?: boolean;
}

/**
 * Server-side Redis Lua script for atomic lease budget decrement.
 * This is a Redis EVAL operation (NOT JavaScript eval) — same approach as the
 * mainline LeaseService.
 * KEYS[1] = lease key, ARGV[1] = cost. Returns [newRemaining, success].
 */
const DECREMENT_LUA_SCRIPT = `
  local key = KEYS[1]
  local cost = tonumber(ARGV[1])
  local leaseJson = redis.call('GET', key)
  if not leaseJson then
    return {-1, 0}
  end
  local lease = cjson.decode(leaseJson)
  local remaining = tonumber(lease.remainingBudget) or 0
  if remaining < cost then
    return {0, 0}
  end
  local newRemaining = remaining - cost
  lease.remainingBudget = newRemaining
  local ttl = redis.call('TTL', key)
  if ttl > 0 then
    redis.call('SETEX', key, ttl, cjson.encode(lease))
  end
  return {newRemaining, 1}
`;

export class ModelLeaseService {
  private static get redis() {
    return getRedisClient();
  }

  static async decrementLeaseBudget(
    params: DecrementModelLeaseParams
  ): Promise<DecrementModelLeaseResult> {
    const { scopeType, scopeId, model, window, cost, resetMode } = params;
    try {
      const redis = ModelLeaseService.redis;
      if (!redis || redis.status !== "ready") {
        return { success: true, newRemaining: -1, failOpen: true };
      }

      const leaseKey =
        params.leaseKeyOverride ?? buildModelLeaseKey(scopeType, scopeId, model, window, resetMode);
      // Redis EVAL (server-side Lua), not JavaScript eval — atomic decrement.
      const result = (await redis.eval(DECREMENT_LUA_SCRIPT, 1, leaseKey, cost)) as [
        number,
        number,
      ];
      const [newRemaining, success] = result;

      if (success === 1) {
        return { success: true, newRemaining };
      }
      return { success: false, newRemaining };
    } catch (error) {
      logger.error("[ModelLease] decrementLeaseBudget failed, fail-open", {
        scopeType,
        scopeId,
        model,
        window,
        cost,
        error,
      });
      return { success: true, newRemaining: -1, failOpen: true };
    }
  }
}
