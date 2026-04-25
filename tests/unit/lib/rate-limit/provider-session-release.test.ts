import { beforeEach, describe, expect, it, vi } from "vitest";

type RedisClientMock = {
  status: string;
  zrem: (key: string, member: string) => Promise<number>;
};

let redisClientRef: RedisClientMock | null;
let zremMock: ReturnType<typeof vi.fn<(key: string, member: string) => Promise<number>>>;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClientRef,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("RateLimitService.releaseProviderSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zremMock = vi.fn(async () => 1);
    redisClientRef = {
      status: "ready",
      zrem: zremMock,
    };
  });

  it("应从供应商 active_sessions ZSET 中释放失败请求的 sessionId", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit/service");

    await RateLimitService.releaseProviderSession(42, "sess_failed");

    expect(zremMock).toHaveBeenCalledTimes(1);
    expect(zremMock).toHaveBeenCalledWith("provider:42:active_sessions", "sess_failed");
  });

  it("Redis 不可用或未 ready 时应静默跳过", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit/service");

    redisClientRef = null;
    await RateLimitService.releaseProviderSession(42, "sess_failed");

    redisClientRef = { status: "connecting", zrem: zremMock };
    await RateLimitService.releaseProviderSession(42, "sess_failed");

    expect(zremMock).not.toHaveBeenCalled();
  });

  it("非法 providerId 或空 sessionId 不应触发 Redis 命令", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit/service");

    await RateLimitService.releaseProviderSession(0, "sess_failed");
    await RateLimitService.releaseProviderSession(-1, "sess_failed");
    await RateLimitService.releaseProviderSession(42, "   ");

    expect(zremMock).not.toHaveBeenCalled();
  });

  it("释放失败时应记录日志但不向请求链路抛错", async () => {
    const error = new Error("redis down");
    zremMock.mockRejectedValueOnce(error);
    const { RateLimitService } = await import("@/lib/rate-limit/service");
    const { logger } = await import("@/lib/logger");

    await expect(
      RateLimitService.releaseProviderSession(42, "sess_failed")
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith("[RateLimit] Failed to release provider session", {
      providerId: 42,
      sessionId: "sess_failed",
      error,
    });
  });
});
