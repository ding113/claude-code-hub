"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  buildBalanceCacheKey,
  readCachedBalance,
  writeCachedBalance,
} from "@/lib/provider-balance/cache";
import { mapWithConcurrency } from "@/lib/provider-balance/concurrency";
import { probeProviderBalance } from "@/lib/provider-balance/probe";
import { findAllProviders } from "@/repository/provider";
import {
  PROVIDER_BALANCE_BATCH_LIMIT,
  type ProviderBalanceMap,
  type ProviderBalanceSnapshot,
} from "@/types/provider-balance";
import type { ActionResult } from "./types";

/** 同时探测的上游数量上限 */
const BALANCE_PROBE_CONCURRENCY = 6;

export interface GetProviderBalancesOptions {
  /** 跳过缓存，强制向上游重新查询 */
  refresh?: boolean;
}

/**
 * 批量查询供应商余额。
 *
 * 默认走缓存，只对未命中的供应商发起上游请求；refresh 为 true 时全部重新查询。
 * 未知或无权限的供应商 ID 会被直接忽略，不会出现在返回结果中。
 */
export async function getProviderBalances(
  providerIds: number[],
  options?: GetProviderBalancesOptions
): Promise<ActionResult<ProviderBalanceMap>> {
  const session = await getSession();
  if (session?.user.role !== "admin") {
    return { ok: false, error: "无权限执行此操作" };
  }

  const requestedIds = Array.from(new Set(providerIds)).slice(0, PROVIDER_BALANCE_BATCH_LIMIT);
  if (requestedIds.length === 0) {
    return { ok: true, data: {} };
  }

  const requestedIdSet = new Set(requestedIds);
  const allProviders = await findAllProviders();
  const targets = allProviders.filter((provider) => requestedIdSet.has(provider.id));

  const snapshots = await mapWithConcurrency(
    targets,
    BALANCE_PROBE_CONCURRENCY,
    async (provider): Promise<ProviderBalanceSnapshot> => {
      const cacheKey = buildBalanceCacheKey({
        id: provider.id,
        url: provider.url,
        key: provider.key,
        proxyUrl: provider.proxyUrl,
      });

      if (options?.refresh !== true) {
        const cached = await readCachedBalance(cacheKey);
        if (cached) return cached;
      }

      const snapshot = await probeProviderBalance({
        id: provider.id,
        url: provider.url,
        key: provider.key,
        proxyUrl: provider.proxyUrl,
        proxyFallbackToDirect: provider.proxyFallbackToDirect,
      });
      await writeCachedBalance(cacheKey, snapshot);
      return snapshot;
    }
  );

  logger.debug("getProviderBalances: 批量查询供应商余额完成", {
    requested: requestedIds.length,
    resolved: snapshots.length,
    refresh: options?.refresh === true,
  });

  return {
    ok: true,
    data: Object.fromEntries(
      snapshots.map((snapshot) => [snapshot.providerId, snapshot])
    ) as ProviderBalanceMap,
  };
}

/** 强制刷新单个供应商的余额 */
export async function refreshProviderBalance(
  providerId: number
): Promise<ActionResult<ProviderBalanceSnapshot>> {
  const result = await getProviderBalances([providerId], { refresh: true });
  if (!result.ok) return result;

  const snapshot = result.data[providerId];
  if (!snapshot) {
    return { ok: false, error: "供应商不存在" };
  }

  return { ok: true, data: snapshot };
}
