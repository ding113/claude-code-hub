/**
 * 数据库备份分布式锁服务
 *
 * 使用 Redis 分布式锁防止并发备份操作，避免：
 * - 同时导入和导出导致数据不一致
 * - 多个管理员同时执行导入（cleanFirst）导致数据丢失
 *
 * Fail Open 策略：
 * - Redis 可用：使用分布式锁（支持多实例部署）
 * - Redis 不可用：降级为内存锁（单实例部署仍然安全）
 */

import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";

const LOCK_KEY = "database:backup:lock";
const LOCK_TTL = 5 * 60 * 1000; // 5 分钟（毫秒）

// 内存锁（Redis 不可用时的降级方案）
const inMemoryLock = new Map<string, { owner: string; expiresAt: number }>();

/**
 * 获取锁的唯一标识符（用于安全释放）
 */
function generateLockId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * 尝试获取备份锁
 *
 * @param operation - 操作类型（用于日志记录）
 * @returns lockId（成功）或 null（失败）
 */
export async function acquireBackupLock(operation: "export" | "import"): Promise<string | null> {
  const redis = getRedisClient();
  const lockId = generateLockId();

  // 策略 1：使用 Redis 分布式锁
  if (redis && redis.status === "ready") {
    try {
      // 使用 Lua 脚本实现 SET NX PX（类型安全）
      // 等价于: SET key value NX PX milliseconds
      const luaScript = `
        return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])
      `;

      const result = (await redis.eval(luaScript, 1, LOCK_KEY, lockId, LOCK_TTL.toString())) as
        | string
        | null;

      if (result === "OK") {
        logger.info({
          action: "backup_lock_acquired",
          lockId,
          operation,
          lockType: "redis",
          ttl: LOCK_TTL,
        });
        return lockId;
      }

      // 锁已被占用
      const currentOwner = await redis.get(LOCK_KEY);
      logger.warn({
        action: "backup_lock_conflict",
        operation,
        lockType: "redis",
        currentOwner,
      });
      return null;
    } catch (error) {
      logger.error({
        action: "backup_lock_redis_error",
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
      // 继续尝试内存锁（Fail Open）
    }
  }

  // 策略 2：降级为内存锁（Redis 不可用或出错）
  logger.warn({
    action: "backup_lock_fallback_to_memory",
    operation,
    reason: redis ? "redis_error" : "redis_unavailable",
  });

  // 清理过期的内存锁
  const now = Date.now();
  for (const [key, lock] of inMemoryLock.entries()) {
    if (lock.expiresAt < now) {
      inMemoryLock.delete(key);
      logger.debug({
        action: "backup_lock_memory_expired",
        key,
        owner: lock.owner,
      });
    }
  }

  // 尝试获取内存锁
  if (inMemoryLock.has(LOCK_KEY)) {
    const currentLock = inMemoryLock.get(LOCK_KEY)!;
    logger.warn({
      action: "backup_lock_conflict",
      operation,
      lockType: "memory",
      currentOwner: currentLock.owner,
      expiresAt: new Date(currentLock.expiresAt).toISOString(),
    });
    return null;
  }

  // 获取内存锁
  inMemoryLock.set(LOCK_KEY, {
    owner: lockId,
    expiresAt: now + LOCK_TTL,
  });

  logger.info({
    action: "backup_lock_acquired",
    lockId,
    operation,
    lockType: "memory",
    ttl: LOCK_TTL,
  });

  return lockId;
}

/**
 * 释放备份锁
 *
 * @param lockId - acquireBackupLock 返回的锁 ID
 * @param operation - 操作类型（用于日志记录）
 */
export async function releaseBackupLock(
  lockId: string,
  operation: "export" | "import"
): Promise<void> {
  const redis = getRedisClient();

  // 策略 1：释放 Redis 锁（使用 Lua 脚本保证原子性）
  if (redis && redis.status === "ready") {
    try {
      // Lua 脚本：只有当锁的值匹配时才删除（防止释放别人的锁）
      const luaScript = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;

      const result = await redis.eval(luaScript, 1, LOCK_KEY, lockId);

      if (result === 1) {
        logger.info({
          action: "backup_lock_released",
          lockId,
          operation,
          lockType: "redis",
        });
      } else {
        logger.warn({
          action: "backup_lock_release_failed",
          lockId,
          operation,
          lockType: "redis",
          reason: "lock_not_owned_or_expired",
        });
      }
      return;
    } catch (error) {
      logger.error({
        action: "backup_lock_release_redis_error",
        lockId,
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
      // 继续尝试释放内存锁（Fail Open）
    }
  }

  // 策略 2：释放内存锁
  const memoryLock = inMemoryLock.get(LOCK_KEY);
  if (memoryLock && memoryLock.owner === lockId) {
    inMemoryLock.delete(LOCK_KEY);
    logger.info({
      action: "backup_lock_released",
      lockId,
      operation,
      lockType: "memory",
    });
  } else {
    logger.warn({
      action: "backup_lock_release_failed",
      lockId,
      operation,
      lockType: "memory",
      reason: memoryLock ? "lock_not_owned" : "lock_not_found",
    });
  }
}

/**
 * 使用锁包装异步操作
 *
 * @param operation - 操作类型
 * @param fn - 要执行的异步函数
 * @returns 操作结果或 null（获取锁失败）
 */
export async function withBackupLock<T>(
  operation: "export" | "import",
  fn: () => Promise<T>
): Promise<T | null> {
  const lockId = await acquireBackupLock(operation);

  if (!lockId) {
    return null; // 获取锁失败
  }

  try {
    return await fn();
  } finally {
    await releaseBackupLock(lockId, operation);
  }
}
