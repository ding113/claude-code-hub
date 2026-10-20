import { DASHBOARD_COMPAT_HEADER } from "@/lib/api/v1/_shared/constants";
import type { ProviderBalanceMap, ProviderBalanceSnapshot } from "@/types/provider-balance";
import { apiPost, unwrapItems } from "./_compat";

const dashboardCompatOptions = {
  headers: {
    [DASHBOARD_COMPAT_HEADER]: "1",
  },
} as const;

function toBalanceMap(snapshots: ProviderBalanceSnapshot[]): ProviderBalanceMap {
  return Object.fromEntries(
    snapshots.map((snapshot) => [snapshot.providerId, snapshot])
  ) as ProviderBalanceMap;
}

/** 批量查询供应商余额，默认读取服务端缓存快照 */
export function getProviderBalances(
  providerIds: number[],
  options?: { refresh?: boolean }
): Promise<ProviderBalanceMap> {
  return apiPost<{ items?: ProviderBalanceSnapshot[] }>(
    "/api/v1/providers/balances:batch",
    { providerIds, refresh: options?.refresh ?? false },
    dashboardCompatOptions
  ).then((body) => toBalanceMap(unwrapItems(body)));
}

/** 强制刷新单个供应商的余额 */
export function refreshProviderBalance(providerId: number): Promise<ProviderBalanceSnapshot> {
  return apiPost<ProviderBalanceSnapshot>(
    `/api/v1/providers/${providerId}/balance:refresh`,
    undefined,
    dashboardCompatOptions
  );
}
