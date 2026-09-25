import "server-only";

import { createHash } from "node:crypto";
import { RedisKVStore } from "@/lib/redis/redis-kv-store";
import type { ProviderBalanceSnapshot } from "@/types/provider-balance";

/** 余额快照缓存时长（秒） */
export const PROVIDER_BALANCE_CACHE_TTL_SECONDS = parseTtlSeconds(
  process.env.PROVIDER_BALANCE_CACHE_TTL,
  600
);

/** 查询失败的快照缓存更短，避免上游恢复后仍然长时间显示错误 */
export const PROVIDER_BALANCE_FAILURE_TTL_SECONDS = Math.min(
  120,
  PROVIDER_BALANCE_CACHE_TTL_SECONDS
);

function parseTtlSeconds(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const balanceStore = new RedisKVStore<ProviderBalanceSnapshot>({
  prefix: "provider-balance:",
  defaultTtlSeconds: PROVIDER_BALANCE_CACHE_TTL_SECONDS,
});

/**
 * 缓存键带上配置指纹：密钥、地址、代理或 New API 系统访问令牌与用户 ID 改变后旧快照立即失效，
 * 不会把换过凭证的供应商的旧余额继续展示出来。
 */
export function buildBalanceCacheKey(provider: {
  id: number;
  url: string;
  key: string;
  proxyUrl: string | null;
  newApiAccessToken: string | null;
  newApiUserId: number | null;
}): string {
  const fingerprint = createHash("sha256")
    .update(
      [
        provider.url,
        provider.key,
        provider.proxyUrl ?? "",
        provider.newApiAccessToken ?? "",
        provider.newApiUserId === null ? "" : String(provider.newApiUserId),
      ].join("\u0000")
    )
    .digest("hex")
    .slice(0, 16);
  return `${provider.id}:${fingerprint}`;
}

export function readCachedBalance(cacheKey: string): Promise<ProviderBalanceSnapshot | null> {
  return balanceStore.get(cacheKey);
}

export function writeCachedBalance(
  cacheKey: string,
  snapshot: ProviderBalanceSnapshot
): Promise<boolean> {
  const ttl =
    snapshot.status === "ok"
      ? PROVIDER_BALANCE_CACHE_TTL_SECONDS
      : PROVIDER_BALANCE_FAILURE_TTL_SECONDS;
  return balanceStore.set(cacheKey, snapshot, ttl);
}

export function clearCachedBalance(cacheKey: string): Promise<boolean> {
  return balanceStore.delete(cacheKey);
}
