import Redis from "ioredis";
import { logger } from "@/lib/logger";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
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
    redisClient = new Redis(redisUrl, {
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
    });

    redisClient.on("connect", () => {
      logger.info("[Redis] Connected successfully");
    });

    redisClient.on("error", (error) => {
      logger.error("[Redis] Connection error:", error);
    });

    redisClient.on("close", () => {
      logger.warn("[Redis] Connection closed");
    });

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
