/**
 * Active UAs 相关 Redis key 生成器。
 *
 * 说明：
 * - 为兼容 Redis Cluster 下的 Lua 脚本多 key 操作，需要相关 key 共享相同 hash tag，避免 CROSSSLOT。
 * - active_uas 相关 key 统一加 hash tag，避免后续扩展出现 CROSSSLOT 风险。
 */
const ACTIVE_UAS_HASH_TAG = "{active_uas}";

/**
 * 全局活跃 UA ZSET（用于观测）。
 */
export function getGlobalActiveUasKey(): string {
  return `${ACTIVE_UAS_HASH_TAG}:global:active_uas`;
}

/**
 * Key 维度活跃 UA ZSET（用于 Key 并发 UA 上限判断）。
 */
export function getKeyActiveUasKey(keyId: number): string {
  if (!Number.isSafeInteger(keyId)) {
    throw new TypeError("getKeyActiveUasKey: keyId must be a safe integer");
  }
  return `${ACTIVE_UAS_HASH_TAG}:key:${keyId}:active_uas`;
}

/**
 * User 维度活跃 UA ZSET（用于跨多 Key 的 User 并发 UA 上限判断）。
 */
export function getUserActiveUasKey(userId: number): string {
  if (!Number.isSafeInteger(userId)) {
    throw new TypeError("getUserActiveUasKey: userId must be a safe integer");
  }
  return `${ACTIVE_UAS_HASH_TAG}:user:${userId}:active_uas`;
}

/**
 * Provider 维度活跃 UA ZSET（用于 Provider 并发 UA 上限判断）。
 */
export function getProviderActiveUasKey(providerId: number): string {
  if (!Number.isSafeInteger(providerId)) {
    throw new TypeError("getProviderActiveUasKey: providerId must be a safe integer");
  }
  return `${ACTIVE_UAS_HASH_TAG}:provider:${providerId}:active_uas`;
}
