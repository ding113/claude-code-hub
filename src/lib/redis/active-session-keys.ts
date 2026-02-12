/**
 * Active sessions 相关 Redis key 生成器。
 *
 * 说明：
 * - 为兼容 Redis Cluster 下的 Lua 脚本多 key 操作，需要相关 key 共享相同 hash tag，避免 CROSSSLOT。
 * - 目前仅对 global/key/user 三类 active_sessions key 统一加 hash tag；provider 维度不需要。
 */
const ACTIVE_SESSIONS_HASH_TAG = "{active_sessions}";

export function getGlobalActiveSessionsKey(): string {
  return `${ACTIVE_SESSIONS_HASH_TAG}:global:active_sessions`;
}

export function getKeyActiveSessionsKey(keyId: number): string {
  return `${ACTIVE_SESSIONS_HASH_TAG}:key:${keyId}:active_sessions`;
}

export function getUserActiveSessionsKey(userId: number): string {
  return `${ACTIVE_SESSIONS_HASH_TAG}:user:${userId}:active_sessions`;
}
