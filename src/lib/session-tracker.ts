import { logger } from "@/lib/logger";
import { getRedisClient } from "./redis";

/**
 * Session 追踪器 - 统一管理活跃 Session 集合
 *
 * 核心功能：
 * 1. 使用 Sorted Set (ZSET) 管理 session 生命周期（基于时间戳）
 * 2. 自动清理过期 session（5 分钟无活动）
 * 3. 验证 session:${sessionId}:info 是否存在（双重保障）
 * 4. 兼容旧格式（Set）实现零停机迁移
 *
 * 数据结构：
 * - global:active_sessions (ZSET): score = timestamp, member = sessionId
 * - key:${keyId}:active_sessions (ZSET): 同上
 * - provider:${providerId}:active_sessions (ZSET): 同上
 */
export class SessionTracker {
  private static readonly SESSION_TTL = 300000; // 5 分钟（毫秒）

  /**
   * 初始化 SessionTracker，自动清理旧格式数据
   *
   * 应在应用启动时调用一次，清理 global:active_sessions 的旧 Set 数据。
   * 其他 key（provider:*、key:*）在运行时自动清理。
   */
  static async initialize(): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") {
      logger.warn("SessionTracker: Redis not ready, skipping initialization");
      return;
    }

    try {
      const key = "global:active_sessions";
      const exists = await redis.exists(key);

      if (exists === 1) {
        const type = await redis.type(key);

        if (type !== "zset") {
          logger.warn("SessionTracker: Found legacy format, deleting", { key, type });
          await redis.del(key);
          logger.debug("SessionTracker: Deleted legacy key", { key });
        } else {
          logger.trace("SessionTracker: Key is already ZSET format", { key });
        }
      } else {
        logger.trace("SessionTracker: Key does not exist, will be created on first use", { key });
      }
    } catch (error) {
      logger.error("SessionTracker: Initialization failed", { error });
    }
  }

  /**
   * 追踪 session（添加到全局和 key 级集合）
   *
   * 调用时机：SessionGuard 分配 sessionId 后
   *
   * @param sessionId - Session ID
   * @param keyId - API Key ID
   */
  static async trackSession(sessionId: string, keyId: number): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const now = Date.now();
      const pipeline = redis.pipeline();

      // 添加到全局集合（ZSET）
      pipeline.zadd("global:active_sessions", now, sessionId);
      pipeline.expire("global:active_sessions", 3600); // 1 小时兜底 TTL

      // 添加到 key 级集合（ZSET）
      pipeline.zadd(`key:${keyId}:active_sessions`, now, sessionId);
      pipeline.expire(`key:${keyId}:active_sessions`, 3600);

      const results = await pipeline.exec();

      // 检查执行结果，捕获类型冲突错误
      if (results) {
        for (const [err] of results) {
          if (err) {
            logger.error("SessionTracker: Pipeline command failed", { error: err });
            // 如果是类型冲突（WRONGTYPE），自动修复
            if (err.message?.includes("WRONGTYPE")) {
              logger.warn("SessionTracker: Type conflict detected, auto-fixing");
              await SessionTracker.initialize(); // 重新初始化，清理旧数据
              return; // 本次追踪失败，下次请求会成功
            }
          }
        }
      }

      logger.trace("SessionTracker: Tracked session", { sessionId, keyId });
    } catch (error) {
      logger.error("SessionTracker: Failed to track session", { error });
    }
  }

  /**
   * 更新 session 的 provider 信息（同时刷新时间戳）
   *
   * 调用时机：ProviderResolver 选择 provider 后
   *
   * @param sessionId - Session ID
   * @param providerId - Provider ID
   */
  static async updateProvider(sessionId: string, providerId: number): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const now = Date.now();
      const pipeline = redis.pipeline();

      // 更新全局集合时间戳
      pipeline.zadd("global:active_sessions", now, sessionId);

      // 添加到 provider 级集合（ZSET）
      pipeline.zadd(`provider:${providerId}:active_sessions`, now, sessionId);
      pipeline.expire(`provider:${providerId}:active_sessions`, 3600);

      const results = await pipeline.exec();

      // 检查执行结果，捕获类型冲突错误
      if (results) {
        for (const [err] of results) {
          if (err) {
            logger.error("SessionTracker: Pipeline command failed", { error: err });
            if (err.message?.includes("WRONGTYPE")) {
              logger.warn("SessionTracker: Type conflict detected, auto-fixing");
              await SessionTracker.initialize();
              return;
            }
          }
        }
      }

      logger.trace("SessionTracker: Updated provider", { sessionId, providerId });
    } catch (error) {
      logger.error("SessionTracker: Failed to update provider", { error });
    }
  }

  /**
   * 刷新 session 时间戳（滑动窗口）
   *
   * 调用时机：响应完成时
   *
   * @param sessionId - Session ID
   * @param keyId - API Key ID
   * @param providerId - Provider ID
   */
  static async refreshSession(sessionId: string, keyId: number, providerId: number): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const now = Date.now();
      const pipeline = redis.pipeline();

      // 更新所有相关 ZSET 的时间戳（滑动窗口）
      pipeline.zadd("global:active_sessions", now, sessionId);
      pipeline.zadd(`key:${keyId}:active_sessions`, now, sessionId);
      pipeline.zadd(`provider:${providerId}:active_sessions`, now, sessionId);

      // 修复 Bug：同步刷新 session 绑定信息的 TTL
      //
      // 问题：ZSET 条目（上面 zadd）会在每次请求时更新时间戳，但绑定信息 key 的 TTL 不会自动刷新
      // 导致：session 创建 5 分钟后，ZSET 仍有记录（仍被计为活跃），但绑定信息已过期，造成：
      //   1. 并发检查被绕过（无法从绑定信息查询 session 所属 provider/key，检查失效）
      //   2. Session 复用失败（无法确定 session 绑定关系，被迫创建新 session）
      //
      // 解决：每次 refreshSession 时同步刷新绑定信息 TTL（与 ZSET 保持 5 分钟生命周期一致）
      pipeline.expire(`session:${sessionId}:provider`, 300); // 5 分钟（秒）
      pipeline.expire(`session:${sessionId}:key`, 300);
      pipeline.setex(`session:${sessionId}:last_seen`, 300, now.toString());

      const results = await pipeline.exec();

      // 检查执行结果，捕获类型冲突错误
      if (results) {
        for (const [err] of results) {
          if (err) {
            logger.error("SessionTracker: Pipeline command failed", { error: err });
            if (err.message?.includes("WRONGTYPE")) {
              logger.warn("SessionTracker: Type conflict detected, auto-fixing");
              await SessionTracker.initialize();
              return;
            }
          }
        }
      }

      logger.trace("SessionTracker: Refreshed session", { sessionId });
    } catch (error) {
      logger.error("SessionTracker: Failed to refresh session", { error });
    }
  }

  /**
   * 获取全局活跃 session 计数
   *
   * @returns 活跃 session 数量
   */
  static async getGlobalSessionCount(): Promise<number> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return 0;

    try {
      const key = "global:active_sessions";
      const exists = await redis.exists(key);

      if (exists === 1) {
        const type = await redis.type(key);

        if (type !== "zset") {
          logger.warn("SessionTracker: Key is not ZSET, deleting", { key, type });
          await redis.del(key);
          return 0;
        }

        return await SessionTracker.countFromZSet(key);
      }

      return 0;
    } catch (error) {
      logger.error("SessionTracker: Failed to get global session count", { error });
      return 0; // Fail Open
    }
  }

  /**
   * 获取 Key 级活跃 session 计数
   *
   * @param keyId - API Key ID
   * @returns 活跃 session 数量
   */
  static async getKeySessionCount(keyId: number): Promise<number> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return 0;

    try {
      const key = `key:${keyId}:active_sessions`;
      const exists = await redis.exists(key);

      if (exists === 1) {
        const type = await redis.type(key);

        if (type !== "zset") {
          logger.warn("SessionTracker: Key is not ZSET, deleting", { key, type });
          await redis.del(key);
          return 0;
        }

        return await SessionTracker.countFromZSet(key);
      }

      return 0;
    } catch (error) {
      logger.error("SessionTracker: Failed to get key session count", { error, keyId });
      return 0;
    }
  }

  /**
   * 获取 Provider 级活跃 session 计数
   *
   * @param providerId - Provider ID
   * @returns 活跃 session 数量
   */
  static async getProviderSessionCount(providerId: number): Promise<number> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return 0;

    try {
      const key = `provider:${providerId}:active_sessions`;
      const exists = await redis.exists(key);

      if (exists === 1) {
        const type = await redis.type(key);

        if (type !== "zset") {
          logger.warn("SessionTracker: Key is not ZSET, deleting", { key, type });
          await redis.del(key);
          return 0;
        }

        return await SessionTracker.countFromZSet(key);
      }

      return 0;
    } catch (error) {
      logger.error("SessionTracker: Failed to get provider session count", { error, providerId });
      return 0;
    }
  }

  /**
   * 批量获取多个 Provider 的活跃 session 计数
   * 用于避免 N+1 查询问题
   *
   * @param providerIds - Provider ID 列表
   * @returns Map<providerId, count>
   */
  static async getProviderSessionCountBatch(providerIds: number[]): Promise<Map<number, number>> {
    const result = new Map<number, number>();

    // 初始化结果（默认为 0）
    for (const providerId of providerIds) {
      result.set(providerId, 0);
    }

    if (providerIds.length === 0) {
      return result;
    }

    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") {
      return result;
    }

    try {
      const now = Date.now();
      const fiveMinutesAgo = now - SessionTracker.SESSION_TTL;

      // 第一阶段：批量清理过期 session 并获取 session IDs
      const cleanupPipeline = redis.pipeline();
      for (const providerId of providerIds) {
        const key = `provider:${providerId}:active_sessions`;
        // 清理过期 session
        cleanupPipeline.zremrangebyscore(key, "-inf", fiveMinutesAgo);
        // 获取剩余 session IDs
        cleanupPipeline.zrange(key, 0, -1);
      }

      const cleanupResults = await cleanupPipeline.exec();
      if (!cleanupResults) {
        return result;
      }

      // 收集需要验证的 session IDs
      const providerSessionMap = new Map<number, string[]>();
      const allSessionIds: string[] = [];

      for (let i = 0; i < providerIds.length; i++) {
        const providerId = providerIds[i];
        // 每个 provider 有 2 个命令（zremrangebyscore + zrange）
        const zrangeResult = cleanupResults[i * 2 + 1];

        if (zrangeResult && zrangeResult[0] === null) {
          const sessionIds = zrangeResult[1] as string[];
          providerSessionMap.set(providerId, sessionIds);
          allSessionIds.push(...sessionIds);
        } else {
          providerSessionMap.set(providerId, []);
        }
      }

      // 如果没有 session，直接返回
      if (allSessionIds.length === 0) {
        return result;
      }

      // 第二阶段：批量验证所有 session info 是否存在
      const uniqueSessionIds = [...new Set(allSessionIds)];
      const verifyPipeline = redis.pipeline();
      for (const sessionId of uniqueSessionIds) {
        verifyPipeline.exists(`session:${sessionId}:info`);
      }

      const verifyResults = await verifyPipeline.exec();
      if (!verifyResults) {
        return result;
      }

      // 构建有效 session 集合
      const validSessions = new Set<string>();
      for (let i = 0; i < uniqueSessionIds.length; i++) {
        const [err, exists] = verifyResults[i];
        if (!err && exists === 1) {
          validSessions.add(uniqueSessionIds[i]);
        }
      }

      // 第三阶段：统计每个 provider 的有效 session 数量
      for (const providerId of providerIds) {
        const sessionIds = providerSessionMap.get(providerId) || [];
        let count = 0;
        for (const sessionId of sessionIds) {
          if (validSessions.has(sessionId)) {
            count++;
          }
        }
        result.set(providerId, count);
      }

      logger.debug(
        `SessionTracker: Batch session count completed for ${providerIds.length} providers`
      );
      return result;
    } catch (error) {
      logger.error("SessionTracker: Failed to get provider session count batch", { error });
      return result;
    }
  }

  /**
   * 获取活跃 session ID 列表（用于详情页）
   *
   * @returns Session ID 数组
   */
  static async getActiveSessions(): Promise<string[]> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return [];

    try {
      const key = "global:active_sessions";
      const exists = await redis.exists(key);

      if (exists === 1) {
        const type = await redis.type(key);

        if (type !== "zset") {
          logger.warn("SessionTracker: Key is not ZSET, deleting", { key, type });
          await redis.del(key);
          return [];
        }

        const now = Date.now();
        const fiveMinutesAgo = now - SessionTracker.SESSION_TTL;

        // 清理过期 session
        await redis.zremrangebyscore(key, "-inf", fiveMinutesAgo);

        // 获取剩余的 session ID
        return await redis.zrange(key, 0, -1);
      }

      return [];
    } catch (error) {
      logger.error("SessionTracker: Failed to get active sessions", { error });
      return [];
    }
  }

  /**
   * 从 ZSET 计数（新格式）
   *
   * 实现步骤：
   * 1. ZREMRANGEBYSCORE 清理过期 session（5 分钟前）
   * 2. ZRANGE 获取剩余 session ID
   * 3. 批量 EXISTS 验证 session:${sessionId}:info 是否存在
   * 4. 统计真实存在的 session
   *
   * @param key - Redis key
   * @returns 有效 session 数量
   */
  private static async countFromZSet(key: string): Promise<number> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return 0;

    try {
      const now = Date.now();
      const fiveMinutesAgo = now - SessionTracker.SESSION_TTL;

      // 1. 清理过期 session（5 分钟前）
      await redis.zremrangebyscore(key, "-inf", fiveMinutesAgo);

      // 2. 获取剩余的 session ID
      const sessionIds = await redis.zrange(key, 0, -1);
      if (sessionIds.length === 0) return 0;

      // 3. 批量验证 info 是否存在
      const pipeline = redis.pipeline();
      for (const sessionId of sessionIds) {
        pipeline.exists(`session:${sessionId}:info`);
      }
      const results = await pipeline.exec();
      if (!results) return 0;

      // 4. 统计有效 session
      let count = 0;
      for (const result of results) {
        if (result && result[0] === null && result[1] === 1) {
          count++;
        }
      }

      logger.trace("SessionTracker: ZSET count", {
        key,
        validSessions: count,
        total: sessionIds.length,
      });
      return count;
    } catch (error) {
      logger.error("SessionTracker: Failed to count from ZSET", { error, key });
      return 0;
    }
  }

  /**
   * 增加 session 并发计数
   *
   * 调用时机：请求开始时（在 proxy-handler.ts 中）
   *
   * @param sessionId - Session ID
   */
  static async incrementConcurrentCount(sessionId: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const key = `session:${sessionId}:concurrent_count`;
      await redis.incr(key);
      await redis.expire(key, 600); // 10 分钟 TTL（比 session TTL 长一倍，防止计数泄漏）

      logger.trace("SessionTracker: Incremented concurrent count", { sessionId });
    } catch (error) {
      logger.error("SessionTracker: Failed to increment concurrent count", { error, sessionId });
    }
  }

  /**
   * 减少 session 并发计数
   *
   * 调用时机：请求结束时（在 proxy-handler.ts 的 finally 块中）
   *
   * @param sessionId - Session ID
   */
  static async decrementConcurrentCount(sessionId: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") return;

    try {
      const key = `session:${sessionId}:concurrent_count`;
      const newCount = await redis.decr(key);

      // 如果计数降到 0 或负数，删除 key（避免无用 key 堆积）
      if (newCount <= 0) {
        await redis.del(key);
      }

      logger.trace("SessionTracker: Decremented concurrent count", { sessionId, newCount });
    } catch (error) {
      logger.error("SessionTracker: Failed to decrement concurrent count", { error, sessionId });
    }
  }

  /**
   * 获取 session 当前并发计数
   *
   * 调用时机：SessionManager 分配 session ID 时
   *
   * @param sessionId - Session ID
   * @returns 并发请求数量
   */
  static async getConcurrentCount(sessionId: string): Promise<number> {
    const redis = getRedisClient();
    if (!redis || redis.status !== "ready") {
      logger.trace("SessionTracker: Redis not ready, returning 0 for concurrent count");
      return 0;
    }

    try {
      const key = `session:${sessionId}:concurrent_count`;
      const count = await redis.get(key);

      const result = count ? parseInt(count, 10) : 0;
      logger.trace("SessionTracker: Got concurrent count", { sessionId, count: result });
      return result;
    } catch (error) {
      logger.error("SessionTracker: Failed to get concurrent count", { error, sessionId });
      return 0; // Fail Open（降级策略）
    }
  }
}
