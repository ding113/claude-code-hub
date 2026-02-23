import Redis, { type RedisOptions } from "ioredis";
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
 * Build TLS configuration for Redis connection.
 * Supports skipping certificate verification via REDIS_TLS_REJECT_UNAUTHORIZED env.
 * Includes servername for SNI (Server Name Indication) support.
 */
function buildTlsConfig(redisUrl: string): NonNullable<RedisOptions["tls"]> {
  const raw = process.env.REDIS_TLS_REJECT_UNAUTHORIZED?.trim();
  const rejectUnauthorized = raw !== "false" && raw !== "0";

  try {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      servername: url.hostname, // SNI support for cloud Redis providers
      rejectUnauthorized,
    };
  } catch {
    return { rejectUnauthorized };
  }
}

/**
 * Build ioredis connection options with protocol-based TLS detection.
 * - When `rediss://` is used, explicitly enable TLS via `tls: {}`
 * - When `redis://` is used, keep plaintext TCP (no TLS option)
 * - Supports REDIS_TLS_REJECT_UNAUTHORIZED env to skip certificate verification
 */
export function buildRedisOptionsForUrl(redisUrl: string): {
  isTLS: boolean;
  options: RedisOptions;
} {
  const isTLS = (() => {
    try {
      const parsed = new URL(redisUrl);
      return parsed.protocol === "rediss:";
    } catch {
      // fallback when URL cannot be parsed; conservative detection
      return redisUrl.startsWith("rediss://");
    }
  })();

  const baseOptions: RedisOptions = {
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
  };

  const options: RedisOptions = isTLS
    ? { ...baseOptions, tls: buildTlsConfig(redisUrl) }
    : { ...baseOptions };

  return { isTLS, options };
}

export function getRedisClient(input?: { allowWhenRateLimitDisabled?: boolean }): Redis | null {
  // Skip Redis connection during Next.js production build phase (avoid connection attempts)
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return null;
  }

  const redisUrl = process.env.REDIS_URL;
  const rateLimitRaw = process.env.ENABLE_RATE_LIMIT?.trim();
  const isEnabled = rateLimitRaw !== "false" && rateLimitRaw !== "0";
  const allowWhenRateLimitDisabled = input?.allowWhenRateLimitDisabled === true;

  if ((!isEnabled && !allowWhenRateLimitDisabled) || !redisUrl) {
    logger.warn("[Redis] Rate limiting disabled or REDIS_URL not configured");
    return null;
  }

  const safeRedisUrl = maskRedisUrl(redisUrl);

  if (redisClient) {
    if (redisClient.status === "end") {
      redisClient = null;
    } else {
      return redisClient;
    }
  }

  try {
    const { isTLS: useTls, options: redisOptions } = buildRedisOptionsForUrl(redisUrl);

    if (useTls) {
      logger.info("[Redis] Using TLS connection (rediss://)", { redisUrl: safeRedisUrl });
    }

    // 3. 使用组合后的配置创建客户端
    const client = new Redis(redisUrl, redisOptions);
    redisClient = client;

    // 4. 保持原始的事件监听器
    client.on("connect", () => {
      if (redisClient !== client) return;
      logger.info("[Redis] Connected successfully", {
        protocol: useTls ? "rediss" : "redis",
        tlsEnabled: useTls,
        redisUrl: safeRedisUrl,
      });
    });

    client.on("error", (error) => {
      if (redisClient !== client) return;
      logger.error("[Redis] Connection error", {
        error: error instanceof Error ? error.message : String(error),
        protocol: useTls ? "rediss" : "redis",
        tlsEnabled: useTls,
        redisUrl: safeRedisUrl,
      });
    });

    client.on("close", () => {
      if (redisClient !== client) return;
      logger.warn("[Redis] Connection closed", { redisUrl: safeRedisUrl });
    });

    client.on("end", () => {
      if (redisClient !== client) return;
      logger.warn("[Redis] Connection ended, resetting client", { redisUrl: safeRedisUrl });
      redisClient = null;
    });

    // 5. 返回客户端实例
    return client;
  } catch (error) {
    logger.error("[Redis] Failed to initialize:", error, { redisUrl: safeRedisUrl });
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    const client = redisClient;
    await client.quit();
    if (redisClient === client) {
      redisClient = null;
    }
  }
}
