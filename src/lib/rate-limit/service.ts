import { getRedisClient } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { SessionTracker } from "@/lib/session-tracker";
import {
  CHECK_AND_TRACK_SESSION,
  TRACK_COST_5H_ROLLING_WINDOW,
  GET_COST_5H_ROLLING_WINDOW,
} from "@/lib/redis/lua-scripts";
import { sumUserCostToday } from "@/repository/statistics";
import { getTimeRangeForPeriod, getTTLForPeriod, getSecondsUntilMidnight } from "./time-utils";

interface CostLimit {
  amount: number | null;
  period: "5h" | "weekly" | "monthly";
  name: string;
}

export class RateLimitService {
  private static redis = getRedisClient();

  /**
   * 检查金额限制（Key 或 Provider）
   * 优先使用 Redis，失败时降级到数据库查询（防止 Redis 清空后超支）
   */
  static async checkCostLimits(
    id: number,
    type: "key" | "provider",
    limits: {
      limit_5h_usd: number | null;
      limit_weekly_usd: number | null;
      limit_monthly_usd: number | null;
    }
  ): Promise<{ allowed: boolean; reason?: string }> {
    const costLimits: CostLimit[] = [
      { amount: limits.limit_5h_usd, period: "5h", name: "5小时" },
      { amount: limits.limit_weekly_usd, period: "weekly", name: "周" },
      { amount: limits.limit_monthly_usd, period: "monthly", name: "月" },
    ];

    try {
      // Fast Path: Redis 查询
      if (this.redis && this.redis.status === "ready") {
        const now = Date.now();
        const window5h = 5 * 60 * 60 * 1000; // 5 hours in ms

        for (const limit of costLimits) {
          if (!limit.amount || limit.amount <= 0) continue;

          let current = 0;

          // 5h 使用滚动窗口 Lua 脚本
          if (limit.period === "5h") {
            try {
              const key = `${type}:${id}:cost_5h_rolling`;
              const result = (await this.redis.eval(
                GET_COST_5H_ROLLING_WINDOW,
                1, // KEYS count
                key, // KEYS[1]
                now.toString(), // ARGV[1]: now
                window5h.toString() // ARGV[2]: window
              )) as string;

              current = parseFloat(result || "0");

              // Cache Miss 检测：如果返回 0 但 Redis 中没有 key，从数据库恢复
              if (current === 0) {
                const exists = await this.redis.exists(key);
                if (!exists) {
                  logger.info(
                    `[RateLimit] Cache miss for ${type}:${id}:cost_5h, querying database`
                  );
                  return await this.checkCostLimitsFromDatabase(id, type, costLimits);
                }
              }
            } catch (error) {
              logger.error(
                "[RateLimit] 5h rolling window query failed, fallback to database:",
                error
              );
              return await this.checkCostLimitsFromDatabase(id, type, costLimits);
            }
          } else {
            // 周/月使用普通 GET
            const value = await this.redis.get(`${type}:${id}:cost_${limit.period}`);

            // Cache Miss 检测
            if (value === null && limit.amount > 0) {
              logger.info(
                `[RateLimit] Cache miss for ${type}:${id}:cost_${limit.period}, querying database`
              );
              return await this.checkCostLimitsFromDatabase(id, type, costLimits);
            }

            current = parseFloat((value as string) || "0");
          }

          if (current >= limit.amount) {
            return {
              allowed: false,
              reason: `${type === "key" ? "Key" : "供应商"} ${limit.name}消费上限已达到（${current.toFixed(4)}/${limit.amount}）`,
            };
          }
        }

        return { allowed: true };
      }

      // Slow Path: Redis 不可用，降级到数据库
      logger.warn(`[RateLimit] Redis unavailable, checking ${type} cost limits from database`);
      return await this.checkCostLimitsFromDatabase(id, type, costLimits);
    } catch (error) {
      logger.error("[RateLimit] Check failed, fallback to database:", error);
      return await this.checkCostLimitsFromDatabase(id, type, costLimits);
    }
  }

  /**
   * 从数据库检查金额限制（降级路径）
   */
  private static async checkCostLimitsFromDatabase(
    id: number,
    type: "key" | "provider",
    costLimits: CostLimit[]
  ): Promise<{ allowed: boolean; reason?: string }> {
    const { sumKeyCostInTimeRange, sumProviderCostInTimeRange } = await import(
      "@/repository/statistics"
    );

    for (const limit of costLimits) {
      if (!limit.amount || limit.amount <= 0) continue;

      // 计算时间范围（使用新的时间工具函数）
      const { startTime, endTime } = getTimeRangeForPeriod(limit.period);

      // 查询数据库
      const current =
        type === "key"
          ? await sumKeyCostInTimeRange(id, startTime, endTime)
          : await sumProviderCostInTimeRange(id, startTime, endTime);

      // Cache Warming: 写回 Redis
      if (this.redis && this.redis.status === "ready") {
        try {
          if (limit.period === "5h") {
            // 5h 滚动窗口：使用 ZSET + Lua 脚本
            if (current > 0) {
              const now = Date.now();
              const window5h = 5 * 60 * 60 * 1000;
              const key = `${type}:${id}:cost_5h_rolling`;

              await this.redis.eval(
                TRACK_COST_5H_ROLLING_WINDOW,
                1,
                key,
                current.toString(),
                now.toString(),
                window5h.toString()
              );

              logger.info(`[RateLimit] Cache warmed for ${key}, value=${current} (rolling window)`);
            }
          } else {
            // 周/月固定窗口：使用 STRING + 动态 TTL
            const ttl = getTTLForPeriod(limit.period);
            await this.redis.set(
              `${type}:${id}:cost_${limit.period}`,
              current.toString(),
              "EX",
              ttl
            );
            logger.info(
              `[RateLimit] Cache warmed for ${type}:${id}:cost_${limit.period}, value=${current}, ttl=${ttl}s`
            );
          }
        } catch (error) {
          logger.error("[RateLimit] Failed to warm cache:", error);
        }
      }

      if (current >= limit.amount) {
        return {
          allowed: false,
          reason: `${type === "key" ? "Key" : "供应商"} ${limit.name}消费上限已达到（${current.toFixed(4)}/${limit.amount}）`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 检查并发 Session 限制（仅检查，不追踪）
   *
   * 注意：此方法仅用于非供应商级别的限流检查（如 key 级）
   * 供应商级别请使用 checkAndTrackProviderSession 保证原子性
   */
  static async checkSessionLimit(
    id: number,
    type: "key" | "provider",
    limit: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (limit <= 0) {
      return { allowed: true };
    }

    try {
      // 使用 SessionTracker 的统一计数逻辑
      const count =
        type === "key"
          ? await SessionTracker.getKeySessionCount(id)
          : await SessionTracker.getProviderSessionCount(id);

      if (count >= limit) {
        return {
          allowed: false,
          reason: `${type === "key" ? "Key" : "供应商"}并发 Session 上限已达到（${count}/${limit}）`,
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error("[RateLimit] Session check failed:", error);
      return { allowed: true }; // Fail Open
    }
  }

  /**
   * 原子性检查并追踪供应商 Session（解决竞态条件）
   *
   * 使用 Lua 脚本保证"检查 + 追踪"的原子性，防止并发请求同时通过限制检查
   *
   * @param providerId - Provider ID
   * @param sessionId - Session ID
   * @param limit - 并发限制
   * @returns { allowed, count, tracked } - 是否允许、当前并发数、是否已追踪
   */
  static async checkAndTrackProviderSession(
    providerId: number,
    sessionId: string,
    limit: number
  ): Promise<{ allowed: boolean; count: number; tracked: boolean; reason?: string }> {
    if (limit <= 0) {
      return { allowed: true, count: 0, tracked: false };
    }

    if (!this.redis || this.redis.status !== "ready") {
      logger.warn("[RateLimit] Redis not ready, Fail Open");
      return { allowed: true, count: 0, tracked: false };
    }

    try {
      const key = `provider:${providerId}:active_sessions`;
      const now = Date.now();

      // 执行 Lua 脚本：原子性检查 + 追踪（TC-041 修复版）
      const result = (await this.redis.eval(
        CHECK_AND_TRACK_SESSION,
        1, // KEYS count
        key, // KEYS[1]
        sessionId, // ARGV[1]
        limit.toString(), // ARGV[2]
        now.toString() // ARGV[3]
      )) as [number, number, number];

      const [allowed, count, tracked] = result;

      if (allowed === 0) {
        return {
          allowed: false,
          count,
          tracked: false,
          reason: `供应商并发 Session 上限已达到（${count}/${limit}）`,
        };
      }

      return {
        allowed: true,
        count,
        tracked: tracked === 1, // Lua 返回 1 表示新追踪，0 表示已存在
      };
    } catch (error) {
      logger.error("[RateLimit] Atomic check-and-track failed:", error);
      return { allowed: true, count: 0, tracked: false }; // Fail Open
    }
  }

  /**
   * 累加消费（请求结束后调用）
   * 5h 使用滚动窗口（ZSET），周/月使用固定窗口（STRING）
   */
  static async trackCost(
    keyId: number,
    providerId: number,
    sessionId: string,
    cost: number
  ): Promise<void> {
    if (!this.redis || cost <= 0) return;

    try {
      const now = Date.now();
      const window5h = 5 * 60 * 60 * 1000; // 5 hours in ms

      // 计算动态 TTL（周/月）
      const ttlWeekly = getTTLForPeriod("weekly");
      const ttlMonthly = getTTLForPeriod("monthly");

      // 1. 5h 滚动窗口：使用 Lua 脚本（ZSET）
      // Key 的 5h 滚动窗口
      await this.redis.eval(
        TRACK_COST_5H_ROLLING_WINDOW,
        1, // KEYS count
        `key:${keyId}:cost_5h_rolling`, // KEYS[1]
        cost.toString(), // ARGV[1]: cost
        now.toString(), // ARGV[2]: now
        window5h.toString() // ARGV[3]: window
      );

      // Provider 的 5h 滚动窗口
      await this.redis.eval(
        TRACK_COST_5H_ROLLING_WINDOW,
        1,
        `provider:${providerId}:cost_5h_rolling`,
        cost.toString(),
        now.toString(),
        window5h.toString()
      );

      // 2. 周/月固定窗口：使用 STRING + 动态 TTL
      const pipeline = this.redis.pipeline();

      // Key 的周/月消费
      pipeline.incrbyfloat(`key:${keyId}:cost_weekly`, cost);
      pipeline.expire(`key:${keyId}:cost_weekly`, ttlWeekly);

      pipeline.incrbyfloat(`key:${keyId}:cost_monthly`, cost);
      pipeline.expire(`key:${keyId}:cost_monthly`, ttlMonthly);

      // Provider 的周/月消费
      pipeline.incrbyfloat(`provider:${providerId}:cost_weekly`, cost);
      pipeline.expire(`provider:${providerId}:cost_weekly`, ttlWeekly);

      pipeline.incrbyfloat(`provider:${providerId}:cost_monthly`, cost);
      pipeline.expire(`provider:${providerId}:cost_monthly`, ttlMonthly);

      await pipeline.exec();

      logger.debug(`[RateLimit] Tracked cost: key=${keyId}, provider=${providerId}, cost=${cost}`);
    } catch (error) {
      logger.error("[RateLimit] Track cost failed:", error);
      // 不抛出错误，静默失败
    }
  }

  /**
   * 获取当前消费（用于响应头和前端展示）
   * 优先使用 Redis，失败时降级到数据库查询
   */
  static async getCurrentCost(
    id: number,
    type: "key" | "provider",
    period: "5h" | "weekly" | "monthly"
  ): Promise<number> {
    try {
      // Fast Path: Redis 查询
      if (this.redis && this.redis.status === "ready") {
        let current = 0;

        // 5h 使用滚动窗口 Lua 脚本
        if (period === "5h") {
          const now = Date.now();
          const window5h = 5 * 60 * 60 * 1000;
          const key = `${type}:${id}:cost_5h_rolling`;

          const result = (await this.redis.eval(
            GET_COST_5H_ROLLING_WINDOW,
            1,
            key,
            now.toString(),
            window5h.toString()
          )) as string;

          current = parseFloat(result || "0");

          // Cache Hit
          if (current > 0) {
            return current;
          }

          // Cache Miss 检测：如果返回 0 但 Redis 中没有 key，从数据库恢复
          const exists = await this.redis.exists(key);
          if (!exists) {
            logger.info(`[RateLimit] Cache miss for ${type}:${id}:cost_5h, querying database`);
          } else {
            // Key 存在但值为 0，说明真的是 0
            return 0;
          }
        } else {
          // 周/月使用普通 GET
          const value = await this.redis.get(`${type}:${id}:cost_${period}`);

          // Cache Hit
          if (value !== null) {
            return parseFloat(value || "0");
          }

          // Cache Miss: 从数据库恢复
          logger.info(`[RateLimit] Cache miss for ${type}:${id}:cost_${period}, querying database`);
        }
      } else {
        logger.warn(`[RateLimit] Redis unavailable, querying database for ${type} cost`);
      }

      // Slow Path: 数据库查询
      const { sumKeyCostInTimeRange, sumProviderCostInTimeRange } = await import(
        "@/repository/statistics"
      );

      const { startTime, endTime } = getTimeRangeForPeriod(period);
      const current =
        type === "key"
          ? await sumKeyCostInTimeRange(id, startTime, endTime)
          : await sumProviderCostInTimeRange(id, startTime, endTime);

      // Cache Warming: 写回 Redis
      if (this.redis && this.redis.status === "ready") {
        try {
          if (period === "5h") {
            // 5h 滚动窗口：需要将历史数据转换为 ZSET 格式
            // 由于无法精确知道每次消费的时间戳，使用当前时间作为近似
            if (current > 0) {
              const now = Date.now();
              const window5h = 5 * 60 * 60 * 1000;
              const key = `${type}:${id}:cost_5h_rolling`;

              // 将数据库查询到的总额作为单条记录写入
              await this.redis.eval(
                TRACK_COST_5H_ROLLING_WINDOW,
                1,
                key,
                current.toString(),
                now.toString(),
                window5h.toString()
              );

              logger.info(`[RateLimit] Cache warmed for ${key}, value=${current} (rolling window)`);
            }
          } else {
            // 周/月固定窗口：使用 STRING + 动态 TTL
            const ttl = getTTLForPeriod(period);
            await this.redis.set(`${type}:${id}:cost_${period}`, current.toString(), "EX", ttl);
            logger.info(
              `[RateLimit] Cache warmed for ${type}:${id}:cost_${period}, value=${current}, ttl=${ttl}s`
            );
          }
        } catch (error) {
          logger.error("[RateLimit] Failed to warm cache:", error);
        }
      }

      return current;
    } catch (error) {
      logger.error("[RateLimit] Get cost failed:", error);
      return 0;
    }
  }

  /**
   * 检查用户 RPM（每分钟请求数）限制
   * 使用 Redis ZSET 实现滑动窗口
   */
  static async checkUserRPM(
    userId: number,
    rpmLimit: number
  ): Promise<{ allowed: boolean; reason?: string; current?: number }> {
    if (!rpmLimit || rpmLimit <= 0) {
      return { allowed: true }; // 未设置限制
    }

    if (!this.redis) {
      logger.warn("[RateLimit] Redis unavailable, skipping user RPM check");
      return { allowed: true }; // Fail Open
    }

    const key = `user:${userId}:rpm_window`;
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    try {
      // 使用 Pipeline 提高性能
      const pipeline = this.redis.pipeline();

      // 1. 清理 1 分钟前的请求
      pipeline.zremrangebyscore(key, "-inf", oneMinuteAgo);

      // 2. 统计当前请求数
      pipeline.zcard(key);

      const results = await pipeline.exec();
      const count = (results?.[1]?.[1] as number) || 0;

      if (count >= rpmLimit) {
        return {
          allowed: false,
          reason: `用户每分钟请求数上限已达到（${count}/${rpmLimit}）`,
          current: count,
        };
      }

      // 3. 记录本次请求
      await this.redis
        .pipeline()
        .zadd(key, now, `${now}:${Math.random()}`)
        .expire(key, 120) // 2 分钟 TTL
        .exec();

      return { allowed: true, current: count + 1 };
    } catch (error) {
      logger.error(`[RateLimit] User RPM check failed for user ${userId}:`, error);
      return { allowed: true }; // Fail Open
    }
  }

  /**
   * 检查用户每日消费额度限制
   * 优先使用 Redis，失败时降级到数据库查询
   */
  static async checkUserDailyCost(
    userId: number,
    dailyLimitUsd: number
  ): Promise<{ allowed: boolean; reason?: string; current?: number }> {
    if (!dailyLimitUsd || dailyLimitUsd <= 0) {
      return { allowed: true }; // 未设置限制
    }

    const key = `user:${userId}:daily_cost`;
    let currentCost = 0;

    try {
      // Fast Path: Redis 查询
      if (this.redis) {
        const cached = await this.redis.get(key);
        if (cached !== null) {
          currentCost = parseFloat(cached);
        } else {
          // Cache Miss: 从数据库恢复
          logger.info(`[RateLimit] Cache miss for ${key}, querying database`);
          currentCost = await sumUserCostToday(userId);

          // Cache Warming: 写回 Redis（使用新的时间工具函数）
          const secondsUntilMidnight = getSecondsUntilMidnight();
          await this.redis.set(key, currentCost.toString(), "EX", secondsUntilMidnight);
        }
      } else {
        // Slow Path: 数据库查询（Redis 不可用）
        logger.warn("[RateLimit] Redis unavailable, querying database for user daily cost");
        currentCost = await sumUserCostToday(userId);
      }

      if (currentCost >= dailyLimitUsd) {
        return {
          allowed: false,
          reason: `用户每日消费上限已达到（$${currentCost.toFixed(4)}/$${dailyLimitUsd}）`,
          current: currentCost,
        };
      }

      return { allowed: true, current: currentCost };
    } catch (error) {
      logger.error(`[RateLimit] User daily cost check failed for user ${userId}:`, error);
      return { allowed: true }; // Fail Open
    }
  }

  /**
   * 累加用户今日消费（在 trackCost 后调用）
   */
  static async trackUserDailyCost(userId: number, cost: number): Promise<void> {
    if (!this.redis || cost <= 0) return;

    const key = `user:${userId}:daily_cost`;

    try {
      const secondsUntilMidnight = getSecondsUntilMidnight();

      await this.redis.pipeline().incrbyfloat(key, cost).expire(key, secondsUntilMidnight).exec();

      logger.debug(`[RateLimit] Tracked user daily cost: user=${userId}, cost=${cost}`);
    } catch (error) {
      logger.error(`[RateLimit] Failed to track user daily cost:`, error);
    }
  }
}
