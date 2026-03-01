/**
 * Active UAs 相关 Redis key 生成器。
 *
 * 说明：
 * - 为兼容 Redis Cluster 下的 Lua 脚本多 key 操作，需要相关 key 共享相同 hash tag，避免 CROSSSLOT。
 * - 目前仅对 global/key/user 三类 active_uas key 统一加 hash tag；provider 维度不需要。
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
  return `${ACTIVE_UAS_HASH_TAG}:key:${keyId}:active_uas`;
}

/**
 * User 维度活跃 UA ZSET（用于跨多 Key 的 User 并发 UA 上限判断）。
 */
export function getUserActiveUasKey(userId: number): string {
  return `${ACTIVE_UAS_HASH_TAG}:user:${userId}:active_uas`;
}
