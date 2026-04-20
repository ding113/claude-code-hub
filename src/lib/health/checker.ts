import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/drizzle/db";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";
import { APP_VERSION } from "@/lib/version";
import type { ComponentHealth, HealthCheckResponse } from "./types";

// -- 版本 --

const cachedVersion = APP_VERSION.replace(/^v/i, "");

export function getAppVersion(): string {
  return cachedVersion;
}

// -- 超时工具 --

const DB_CHECK_TIMEOUT_MS = 3_000;
const REDIS_CHECK_TIMEOUT_MS = 2_000;
const DATABASE_FAILURE_MESSAGE = "Database connection failed";
const REDIS_FAILURE_MESSAGE = "Redis connection failed";
const PROXY_FAILURE_MESSAGE = "Proxy request failed";

function logHealthFailure(component: "database" | "redis" | "proxy", error: unknown): void {
  logger.warn(`[Health] ${component} check failed`, {
    error: error instanceof Error ? error.message : String(error),
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} health check timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// -- 数据库检查 --

export async function checkDatabase(): Promise<ComponentHealth> {
  const start = performance.now();
  try {
    const dsn = process.env.DSN?.trim();
    if (!dsn) {
      return {
        status: process.env.NODE_ENV === "test" ? "unchecked" : "down",
        message: "Database not configured",
      };
    }

    await withTimeout(db.execute(sql`SELECT 1`), DB_CHECK_TIMEOUT_MS, "database");
    return { status: "up", latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    logHealthFailure("database", error);
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - start),
      message: DATABASE_FAILURE_MESSAGE,
    };
  }
}

// -- Redis 检查 --

export async function checkRedis(): Promise<ComponentHealth> {
  const start = performance.now();
  try {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) {
      return { status: "unchecked", message: "Redis not configured" };
    }

    const client = getRedisClient({ allowWhenRateLimitDisabled: true });
    if (!client) {
      return {
        status: "down",
        latencyMs: Math.round(performance.now() - start),
        message: "Redis client initialization failed",
      };
    }
    if (client.status === "end" || client.status === "close") {
      return {
        status: "down",
        latencyMs: Math.round(performance.now() - start),
        message: `Redis client status: ${client.status}`,
      };
    }
    await withTimeout(client.ping(), REDIS_CHECK_TIMEOUT_MS, "redis");
    return { status: "up", latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    logHealthFailure("redis", error);
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - start),
      message: REDIS_FAILURE_MESSAGE,
    };
  }
}

// -- Hono 代理层自检 --

const PROXY_CHECK_TIMEOUT_MS = 2_000;

export async function checkProxy(): Promise<ComponentHealth> {
  const start = performance.now();
  try {
    const { v1App } = await import("@/app/v1/[...route]/route");
    const res = await withTimeout(
      Promise.resolve(v1App.request("/v1/_ping", { method: "GET" })),
      PROXY_CHECK_TIMEOUT_MS,
      "proxy"
    );
    if (res.ok) {
      return { status: "up", latencyMs: Math.round(performance.now() - start) };
    }
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - start),
      message: `Proxy returned HTTP ${res.status}`,
    };
  } catch (error) {
    logHealthFailure("proxy", error);
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - start),
      message: PROXY_FAILURE_MESSAGE,
    };
  }
}

// -- 综合判定 --

export async function checkReadiness(): Promise<HealthCheckResponse> {
  const version = getAppVersion();
  const [database, redis, proxy] = await Promise.all([checkDatabase(), checkRedis(), checkProxy()]);

  // DB 必需，Redis/Proxy 可选（降级但不摘流量）
  let status: HealthCheckResponse["status"] = "healthy";
  if (database.status === "down") {
    status = "unhealthy";
  } else if (redis.status === "down" || proxy.status === "down") {
    status = "degraded";
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    version,
    uptime: Math.round(process.uptime()),
    components: { database, redis, proxy },
  };
}

// -- 共享路由 handler --

export async function handleReadinessRequest(action: string): Promise<NextResponse> {
  try {
    const health = await checkReadiness();
    const httpStatus = health.status === "unhealthy" ? 503 : 200;
    return NextResponse.json(health, { status: httpStatus });
  } catch (error) {
    const { logger } = await import("@/lib/logger");
    logger.error({
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { status: "unhealthy", timestamp: new Date().toISOString(), error: "Health check failed" },
      { status: 503 }
    );
  }
}
