import Decimal from "decimal.js-light";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";
import { RESERVE_PROVIDER_BALANCE, SETTLE_PROVIDER_BALANCE } from "@/lib/redis/lua-scripts";
import { COST_SCALE, toCostDecimal } from "@/lib/utils/currency";

const DEFAULT_ESTIMATE = Number(process.env.BALANCE_RESERVE_ESTIMATE_USD ?? 0.1);
const MIN_ESTIMATE = 0.01;
const MAX_ESTIMATE = 1;
const RESERVED_CAP_MULTIPLIER = Number(process.env.BALANCE_RESERVED_CAP_MULTIPLIER ?? 1.0);
const REDIS_FAIL_CLOSE_THRESHOLD = Number(
  process.env.BALANCE_REDIS_FAIL_CLOSE_THRESHOLD_USD ?? 0.1
);
const RESERVE_TTL_SECONDS = 300; // 5 分钟，避免悬挂占用

function clampEstimate(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_ESTIMATE;
  }
  return Math.min(Math.max(value, MIN_ESTIMATE), MAX_ESTIMATE);
}

function buildKeys(providerId: number, reserveId?: string) {
  const stateKey = `provider:${providerId}:balance`;
  const reserveKey = reserveId ? `provider:${providerId}:balance:reserve:${reserveId}` : "";
  return { stateKey, reserveKey };
}

export type ReserveResult = {
  allowed: boolean;
  balance: number;
  reserved: number;
  reservedAdded: number;
  reused: boolean;
};

export async function reserveProviderBalance(opts: {
  providerId: number;
  balanceUsd: number;
  reserveId?: string;
  estimatedCost?: Decimal;
  reservedCapMultiplier?: number;
}): Promise<ReserveResult> {
  const redis = await getRedisClient();
  if (!redis) {
    const shouldFailClose =
      Number.isFinite(REDIS_FAIL_CLOSE_THRESHOLD) && opts.balanceUsd <= REDIS_FAIL_CLOSE_THRESHOLD;
    logger.warn("[BalanceReserve] Redis unavailable, applying fail-open/fail-close policy", {
      providerId: opts.providerId,
      balance: opts.balanceUsd,
      threshold: REDIS_FAIL_CLOSE_THRESHOLD,
      failClose: shouldFailClose,
    });
    return shouldFailClose
      ? { allowed: false, balance: opts.balanceUsd, reserved: 0, reservedAdded: 0, reused: false }
      : { allowed: true, balance: opts.balanceUsd, reserved: 0, reservedAdded: 0, reused: false };
  }

  const estimate = toCostDecimal(opts.estimatedCost ?? clampEstimate(DEFAULT_ESTIMATE));
  if (!estimate || estimate.lte(0)) {
    return {
      allowed: true,
      balance: opts.balanceUsd,
      reserved: 0,
      reservedAdded: 0,
      reused: false,
    };
  }

  const estimateStr = estimate.toFixed(COST_SCALE);
  const reservedCap = Math.max(
    0,
    opts.balanceUsd * (opts.reservedCapMultiplier ?? RESERVED_CAP_MULTIPLIER)
  );
  const reservedCapStr = reservedCap.toFixed(6);
  const { stateKey, reserveKey } = buildKeys(opts.providerId, opts.reserveId);
  const keys = reserveKey ? [stateKey, reserveKey] : [stateKey];
  const numKeys = keys.length;

  try {
    const result = (await redis.eval(
      RESERVE_PROVIDER_BALANCE,
      numKeys,
      ...keys,
      estimateStr,
      reservedCapStr,
      RESERVE_TTL_SECONDS.toString(),
      opts.balanceUsd.toString()
    )) as [number, number, number, number, number];

    const [allowed, balance, reserved, reservedAdded, reused] = result;

    return {
      allowed: allowed === 1,
      balance: balance ?? 0,
      reserved: reserved ?? 0,
      reservedAdded: reservedAdded ?? 0,
      reused: reused === 1,
    };
  } catch (error) {
    logger.error("[BalanceReserve] Reserve eval failed", {
      providerId: opts.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    // fail-open，但不记录预占
    return {
      allowed: true,
      balance: opts.balanceUsd,
      reserved: 0,
      reservedAdded: 0,
      reused: false,
    };
  }
}

export async function settleProviderBalance(opts: {
  providerId: number;
  reserveId?: string;
  actualCost: Decimal;
  estimate: Decimal;
}): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) {
    logger.warn("[BalanceReserve] Redis unavailable during settle", {
      providerId: opts.providerId,
    });
    return;
  }

  const actual = toCostDecimal(opts.actualCost);
  const estimate = toCostDecimal(opts.estimate);
  if (!actual || !estimate) {
    return;
  }

  const { stateKey, reserveKey } = buildKeys(opts.providerId, opts.reserveId);
  const keys = reserveKey ? [stateKey, reserveKey] : [stateKey];
  const numKeys = keys.length;
  const actualStr = actual.toFixed(COST_SCALE);
  const estimateStr = estimate.toFixed(COST_SCALE);

  try {
    await redis.eval(SETTLE_PROVIDER_BALANCE, numKeys, ...keys, actualStr, estimateStr);
  } catch (error) {
    logger.error("[BalanceReserve] Settle eval failed", {
      providerId: opts.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
