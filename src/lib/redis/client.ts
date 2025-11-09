import Redis, { RedisOptions } from "ioredis";
import { logger } from "@/lib/logger";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  // Skip Redis connection during CI/build phase (avoid connection attempts)
  if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") {
    return null;
  }

  const redisUrl = process.env.REDIS_URL;
  const isEnabled = process.env.ENABLE_RATE_LIMIT === "true";

  if (!isEnabled || !redisUrl) {
    logger.warn("[Redis] Rate limiting disabled or REDIS_URL not configured");
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  try {
    const useTls = redisUrl.startsWith("rediss://");

    // 1. 定义基础配置
    const redisOptions: RedisOptions = {
      enableOfflineQueue: false, // 快速失败
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) {
          logger.error("[Redis] Max retries reached, giving up");
          return null; // 停止重试，降级
        }
        const delay = Math.min(times * 200, 2000);
        logger.warn(`[Redis] Retry ${times}/5 after ${delay}ms`);
        return delay;
      },
    };

    // 2. 如果使用 rediss://，则添加显式的 TLS 和 SNI (host) 配置
    if (useTls) {
      logger.info("[Redis] Using TLS connection (rediss://)");
      try {
        // 从 URL 中解析 hostname，用于 SNI
        const url = new URL(redisUrl);
        redisOptions.tls = {
          host: url.hostname,
        };
      } catch (e) {
        logger.error("[Redis] Failed to parse REDIS_URL for TLS host:", e);
        // 如果 URL 解析失败，回退
        redisOptions.tls = {};
      }
    }

    // 3. 使用组合后的配置创建客户端
    redisClient = new Redis(redisUrl, redisOptions);

    // 4. 保持原始的事件监听器
    redisClient.on("connect", () => {
      logger.info("[Redis] Connected successfully");
    });

    redisClient.on("error", (error) => {
      logger.error("[Redis] Connection error:", error);
    });

    redisClient.on("close", () => {
      logger.warn("[Redis] Connection closed");
    });

    // 5. 返回客户端实例
    return redisClient;

  } catch (error) {
    logger.error("[Redis] Failed to initialize:", error);
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}