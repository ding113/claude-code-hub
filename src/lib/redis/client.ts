import Redis from "ioredis";
import { logger } from "@/lib/logger";

let redisClient: Redis | null = null;

/**
 * Mask password in a URL for safe logging.
 * Example: rediss://user:pass@host:6379 -> rediss://user:***@host:6379
 */
function maskRedisUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return urlStr.replace(/:(?:[^:@]+)@/, ":***@");
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

  if (redisClient) {
    return redisClient;
  }

  try {
    const { isTLS, options } = buildRedisOptionsForUrl(redisUrl);

    // Parse URL for safe, structured connection logging
    let proto = "";
    let host = "";
    let port = "";
    try {
      const u = new URL(redisUrl);
      proto = u.protocol.replace(":", "");
      host = u.hostname;
      port = u.port;
    } catch {
      // ignore parse error; still proceed
    }

    logger.info("[Redis] Connecting", {
      url: maskRedisUrl(redisUrl),
      protocol: proto || (isTLS ? "rediss" : "redis"),
      host,
      port,
      tlsEnabled: isTLS,
    });

    redisClient = new Redis(redisUrl, options);

    redisClient.on("connect", () => {
      logger.info("[Redis] Connected successfully", {
        protocol: proto || (options as unknown as { tls?: object }).tls ? "rediss" : "redis",
        host,
        port,
        tlsEnabled: Boolean((options as unknown as { tls?: object }).tls),
      });
    });

    redisClient.on("error", (error) => {
      logger.error("[Redis] Connection error", {
        error: error instanceof Error ? error.message : String(error),
        protocol: proto || (isTLS ? "rediss" : "redis"),
        host,
        port,
        tlsEnabled: isTLS,
      });
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
