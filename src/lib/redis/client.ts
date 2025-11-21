import Redis, { RedisOptions } from "ioredis";
import { logger } from "@/lib/logger";

let redisClient: Redis | null = null;

function maskRedisUrl(redisUrl: string) {
  try {
    const parsed = new URL(redisUrl);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return redisUrl.replace(/:\w+@/, ":****@");
  }
}

/**
 * Build ioredis connection options with protocol-based TLS detection.
 * - When `rediss://` is used, explicitly enable TLS via `tls: {}`
 * - When `redis://` is used, keep plaintext TCP (no TLS option)
 */
export function buildRedisOptionsForUrl(redisUrl: string) {
  const isTLS = (() => {
    try {
      const parsed = new URL(redisUrl);
      return parsed.protocol === "rediss:";
    } catch {
      // fallback when URL cannot be parsed; conservative detection
      return redisUrl.startsWith("rediss://");
    }
  })();

  const baseOptions = {
    enableOfflineQueue: false, // 快速失败
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 5) {
        logger.error("[Redis] Max retries reached, giving up");
        return null; // 停止重试，降级
      }
      const delay = Math.min(times * 200, 2000);
      logger.warn(`[Redis] Retry ${times}/5 after ${delay}ms`);
      return delay;
    },
  } as const;

  // Explicit TLS config for Upstash and other managed Redis providers
  const tlsOptions = isTLS ? { tls: {} as Record<string, unknown> } : {};

  return { isTLS, options: { ...baseOptions, ...tlsOptions } };
}

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

  const safeRedisUrl = maskRedisUrl(redisUrl);

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
      logger.info("[Redis] Using TLS connection (rediss://)", { redisUrl: safeRedisUrl });
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
      logger.info("[Redis] Connected successfully", {
        protocol: useTls ? "rediss" : "redis",
        tlsEnabled: useTls,
        redisUrl: safeRedisUrl,
      });
    });

    redisClient.on("error", (error) => {
      logger.error("[Redis] Connection error", {
        error: error instanceof Error ? error.message : String(error),
        protocol: useTls ? "rediss" : "redis",
        tlsEnabled: useTls,
        redisUrl: safeRedisUrl,
      });
    });

    redisClient.on("close", () => {
      logger.warn("[Redis] Connection closed", { redisUrl: safeRedisUrl });
    });

    // 5. 返回客户端实例
    return redisClient;
  } catch (error) {
    logger.error("[Redis] Failed to initialize:", error, { redisUrl: safeRedisUrl });
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
