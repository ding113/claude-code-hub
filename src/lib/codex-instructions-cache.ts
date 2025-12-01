/**
 * Codex Instructions 缓存工具类
 *
 * Phase 3: 自动学习和缓存上游中转站下发的 instructions
 * - 成功响应时缓存 instructions（按供应商 + 模型）
 * - 请求时检查缓存，不匹配则自动覆盖
 * - TTL 24 小时
 * - Fail Open 策略：Redis 不可用时降级
 */

import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";

export class CodexInstructionsCache {
  private static readonly CACHE_PREFIX = "codex:instructions";
  private static readonly TTL_SECONDS = 86400; // 24 小时

  /**
   * 生成缓存 Key
   * 格式：codex:instructions:{providerId}:{model}
   */
  private static getCacheKey(providerId: number, model: string): string {
    return `${CodexInstructionsCache.CACHE_PREFIX}:${providerId}:${model}`;
  }

  /**
   * 获取缓存的 instructions
   *
   * @param providerId - 供应商 ID
   * @param model - 模型名称
   * @returns 缓存的 instructions，未找到或失败时返回 null
   */
  static async get(providerId: number, model: string): Promise<string | null> {
    const redis = getRedisClient();
    if (!redis) {
      logger.debug("[CodexInstructionsCache] Redis not available, skipping cache read");
      return null;
    }

    try {
      const key = CodexInstructionsCache.getCacheKey(providerId, model);
      const cached = await redis.get(key);

      if (cached) {
        logger.debug("[CodexInstructionsCache] Cache hit", {
          providerId,
          model,
          instructionsLength: cached.length,
        });
        return cached;
      }

      logger.debug("[CodexInstructionsCache] Cache miss", {
        providerId,
        model,
      });
      return null;
    } catch (error) {
      // Fail Open: Redis 错误时降级，不影响主流程
      logger.warn("[CodexInstructionsCache] Failed to read cache, degrading gracefully", {
        providerId,
        model,
        error,
      });
      return null;
    }
  }

  /**
   * 存储 instructions 到缓存
   *
   * @param providerId - 供应商 ID
   * @param model - 模型名称
   * @param instructions - instructions 内容
   */
  static async set(providerId: number, model: string, instructions: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) {
      logger.debug("[CodexInstructionsCache] Redis not available, skipping cache write");
      return;
    }

    if (!instructions || typeof instructions !== "string") {
      logger.debug("[CodexInstructionsCache] Invalid instructions, skipping cache write", {
        providerId,
        model,
        instructionsType: typeof instructions,
      });
      return;
    }

    try {
      const key = CodexInstructionsCache.getCacheKey(providerId, model);
      await redis.setex(key, CodexInstructionsCache.TTL_SECONDS, instructions);

      logger.info("[CodexInstructionsCache] Cached instructions successfully", {
        providerId,
        model,
        instructionsLength: instructions.length,
        ttl: CodexInstructionsCache.TTL_SECONDS,
      });
    } catch (error) {
      // Fail Open: Redis 错误时降级，不影响主流程
      logger.warn("[CodexInstructionsCache] Failed to write cache, degrading gracefully", {
        providerId,
        model,
        error,
      });
    }
  }

  /**
   * 清除特定供应商的所有缓存
   *
   * @param providerId - 供应商 ID
   */
  static async clearByProvider(providerId: number): Promise<void> {
    const redis = getRedisClient();
    if (!redis) {
      logger.debug("[CodexInstructionsCache] Redis not available, skipping cache clear");
      return;
    }

    try {
      const pattern = `${CodexInstructionsCache.CACHE_PREFIX}:${providerId}:*`;
      const keys = await redis.keys(pattern);

      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info("[CodexInstructionsCache] Cleared provider cache", {
          providerId,
          keysCleared: keys.length,
        });
      } else {
        logger.debug("[CodexInstructionsCache] No cache keys found for provider", {
          providerId,
        });
      }
    } catch (error) {
      logger.error("[CodexInstructionsCache] Failed to clear provider cache", {
        providerId,
        error,
      });
    }
  }
}
