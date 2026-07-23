import "server-only";

import { addDays, addMonths, addWeeks, startOfDay, startOfISOWeek, startOfMonth } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerCacheEffectiveness } from "@/drizzle/schema";
import type { ProviderCacheEffectivenessWindow } from "@/types/provider-cache-effectiveness";
import type { DateRangeParams, LeaderboardPeriod } from "./leaderboard";

export interface ListProviderCacheEffectivenessOptions {
  providerId?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listProviderCacheEffectivenessWindows(
  options: ListProviderCacheEffectivenessOptions = {}
): Promise<ProviderCacheEffectivenessWindow[]> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = await db
    .select()
    .from(providerCacheEffectiveness)
    .where(
      options.providerId === undefined
        ? undefined
        : eq(providerCacheEffectiveness.providerId, options.providerId)
    )
    // 窗口首尾单调等价；用 windowStart 吻合既有索引 (provider_id, model, window_start DESC)
    .orderBy(desc(providerCacheEffectiveness.windowStart), desc(providerCacheEffectiveness.id))
    .limit(limit);
  return rows;
}

/**
 * 供应商缓存系数（排行榜展示用）：跨 model/TTL 桶汇总后按 service.ts 同一套定点公式重算。
 */
export interface ProviderCacheCoefficient {
  providerId: number;
  /** 万分比定点值：实际 x 理论综合的归一化缓存效果分 */
  coefficientBp: number;
  sampleCount: number;
}

// tsconfig target ES2017 禁 BigInt 字面量，统一用 BigInt() 构造
const BIG_ZERO = BigInt(0);
const BP_SCALE = BigInt(10000);

/** 在汇总值上重算 effectivenessBp（与 service.ts 单窗口 SQL 公式一致，全 BigInt 整数运算） */
function computeCoefficientBp(
  sample: bigint,
  eligible: bigint,
  theoretical: bigint,
  observed: bigint
): number {
  let rawBp = theoretical > BIG_ZERO ? (observed * BP_SCALE) / theoretical : BIG_ZERO;
  if (rawBp > BP_SCALE) rawBp = BP_SCALE;
  const sampleFactorBp =
    eligible >= BigInt(100)
      ? BigInt(10000)
      : eligible >= BigInt(30)
        ? BigInt(6000)
        : eligible >= BigInt(5)
          ? BigInt(3000)
          : BigInt(1000);
  const observableBp = sample > BIG_ZERO ? (eligible * BP_SCALE) / sample : BIG_ZERO;
  const confidenceBp = (observableBp * sampleFactorBp) / BP_SCALE;
  return Number((rawBp * confidenceBp) / BP_SCALE);
}

/**
 * 把排行榜周期解析成 [start, end] 时间窗（语义对齐 leaderboard.ts 的 buildDateCondition）。
 * daily/weekly/monthly 按系统时区取当期边界；custom 用 dateRange；allTime 从 epoch 起。
 */
export function resolveLeaderboardWindow(
  period: LeaderboardPeriod,
  timezone: string,
  dateRange?: DateRangeParams
): { start: Date; end: Date } {
  const now = new Date();

  if (period === "custom" && dateRange) {
    const endExclusive = addDays(new Date(`${dateRange.endDate}T00:00:00Z`), 1);
    return {
      start: fromZonedTime(`${dateRange.startDate}T00:00:00`, timezone),
      end: fromZonedTime(`${endExclusive.toISOString().slice(0, 10)}T00:00:00`, timezone),
    };
  }

  switch (period) {
    case "daily": {
      const localStart = startOfDay(toZonedTime(now, timezone));
      return {
        start: fromZonedTime(localStart, timezone),
        end: fromZonedTime(addDays(localStart, 1), timezone),
      };
    }
    case "weekly": {
      // DATE_TRUNC('week') 为 ISO 周（周一起始）
      const localStart = startOfISOWeek(toZonedTime(now, timezone));
      return {
        start: fromZonedTime(localStart, timezone),
        end: fromZonedTime(addWeeks(localStart, 1), timezone),
      };
    }
    case "monthly": {
      const localStart = startOfMonth(toZonedTime(now, timezone));
      return {
        start: fromZonedTime(localStart, timezone),
        end: fromZonedTime(addMonths(localStart, 1), timezone),
      };
    }
    case "last24h":
      return { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now };
    default:
      // allTime 及缺 dateRange 的 custom（对齐 buildDateCondition 的 1=1 兜底）
      return { start: new Date(0), end: now };
  }
}

/**
 * 聚合 windowEnd 落在 (start, end] 内的缓存效果窗口，按 provider 求缓存系数。
 * 无数据的 provider 不出现在结果里。
 */
export async function getProviderCacheCoefficients({
  start,
  end,
}: {
  start: Date;
  end: Date;
}): Promise<Map<number, ProviderCacheCoefficient>> {
  const rows = await db
    .select({
      providerId: providerCacheEffectiveness.providerId,
      sampleCount: sql<string>`COALESCE(sum(${providerCacheEffectiveness.sampleCount}), 0)::bigint`,
      eligibleCount: sql<string>`COALESCE(sum(${providerCacheEffectiveness.eligibleCount}), 0)::bigint`,
      theoreticalCacheTokens: sql<string>`COALESCE(sum(${providerCacheEffectiveness.theoreticalCacheTokens}), 0)::bigint`,
      observedCacheReadTokens: sql<string>`COALESCE(sum(${providerCacheEffectiveness.observedCacheReadTokens}), 0)::bigint`,
    })
    .from(providerCacheEffectiveness)
    .where(
      and(
        gt(providerCacheEffectiveness.windowEnd, start),
        lte(providerCacheEffectiveness.windowEnd, end)
      )
    )
    .groupBy(providerCacheEffectiveness.providerId);

  const coefficients = new Map<number, ProviderCacheCoefficient>();
  for (const row of rows) {
    const sample = BigInt(row.sampleCount);
    coefficients.set(row.providerId, {
      providerId: row.providerId,
      coefficientBp: computeCoefficientBp(
        sample,
        BigInt(row.eligibleCount),
        BigInt(row.theoreticalCacheTokens),
        BigInt(row.observedCacheReadTokens)
      ),
      sampleCount: Number(sample),
    });
  }
  return coefficients;
}
