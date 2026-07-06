import type Queue from "bull";
import { logger } from "@/lib/logger";

/** 原始 % 等非法转义按原文回退:解码前的旧行为接受这类密码,启动崩溃属回归 */
function safeDecodeUserinfo(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 解析 REDIS_URL 为 Bull 的 redis options,与主客户端 ioredis parseURL 行为对齐:
 * userinfo 百分号解码(WHATWG URL 不自动解码)、路径 /N 选择 DB、rediss:// 走 TLS+SNI。
 */
export function buildRedisQueueOptions(
  redisUrl: string,
  logPrefix: string
): Queue.QueueOptions["redis"] {
  const useTls = redisUrl.startsWith("rediss://");
  const redisQueueOptions: Queue.QueueOptions["redis"] = {};

  try {
    const url = new URL(redisUrl);
    redisQueueOptions.host = url.hostname;
    redisQueueOptions.port = parseInt(url.port || "6379", 10);
    redisQueueOptions.password = safeDecodeUserinfo(url.password);
    redisQueueOptions.username = safeDecodeUserinfo(url.username);
    // 支持 redis://host:port/15 形式的 DB 选择
    const dbFromPath = parseInt(url.pathname.slice(1), 10);
    if (!Number.isNaN(dbFromPath)) {
      redisQueueOptions.db = dbFromPath;
    }

    if (useTls) {
      const rejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false";
      logger.info(`${logPrefix} Using TLS connection (rediss://)`, { rejectUnauthorized });
      redisQueueOptions.tls = {
        host: url.hostname,
        servername: url.hostname, // SNI support for cloud Redis providers
        rejectUnauthorized,
      };
    }
  } catch (e) {
    logger.error(`${logPrefix} Failed to parse REDIS_URL, connection will fail:`, e);
    // 如果 URL 格式错误，则抛出异常停止启动
    throw new Error("Invalid REDIS_URL format");
  }

  return redisQueueOptions;
}
