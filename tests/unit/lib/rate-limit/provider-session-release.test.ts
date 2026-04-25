import { beforeEach, describe, expect, it, vi } from "vitest";

type RedisClientMock = {
  status: string;
  eval: (...args: unknown[]) => Promise<[number, number]>;
};

let redisClientRef: RedisClientMock | null;
let evalMock: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<[number, number]>>>;

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
    evalMock = vi.fn(async () => [1, 0]);
    redisClientRef = {
      status: "ready",
      eval: evalMock,
    };
  });

  it("应通过引用计数脚本释放失败请求的 provider session", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit/service");

    await RateLimitService.releaseProviderSession(42, "sess_failed");

    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      2,
      "provider:42:active_sessions",
      "provider:42:active_session_refs",
      "sess_failed"
    );
  });

  it("仍有并发引用时不应直接 ZREM active session", async () => {
    evalMock.mockResolvedValueOnce([0, 1]);
    const { RateLimitService } = await import("@/lib/rate-limit/service");

    await RateLimitService.releaseProviderSession(42, "sess_failed");

    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it("Redis 不可用或未 ready 时应静默跳过", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit/service");

    redisClientRef = null;
    await RateLimitService.releaseProviderSession(42, "sess_failed");

    redisClientRef = { status: "connecting", eval: evalMock };
    await RateLimitService.releaseProviderSession(42, "sess_failed");

    expect(evalMock).not.toHaveBeenCalled();
  });

  it("非法 providerId 或空 sessionId 不应触发 Redis 命令", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit/service");

    await RateLimitService.releaseProviderSession(0, "sess_failed");
    await RateLimitService.releaseProviderSession(-1, "sess_failed");
    await RateLimitService.releaseProviderSession(42, "   ");

    expect(evalMock).not.toHaveBeenCalled();
  });

  it("释放失败时应记录日志但不向请求链路抛错", async () => {
    const error = new Error("redis down");
    evalMock.mockRejectedValueOnce(error);
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
