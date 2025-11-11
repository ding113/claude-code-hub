import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProxyRateLimitGuard } from "./rate-limit-guard";
import { RateLimitService } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import type { ProxySession } from "./session";
import type { User } from "@/types/user";
import type { Key } from "@/types/key";

// Mock dependencies
vi.mock("@/lib/rate-limit");
vi.mock("@/lib/logger");

describe("ProxyRateLimitGuard", () => {
  // Mock ProxySession helper
  const createMockSession = (
    overrides: {
      user?: Partial<User> | null;
      key?: Partial<Key> | null;
    } = {}
  ): ProxySession => {
    const defaultUser: User = {
      id: 1,
      name: "test-user",
      description: "Test user",
      role: "user",
      rpm: 100,
      dailyQuota: 50.0,
      providerGroup: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const defaultKey: Key = {
      id: 1,
      userId: 1,
      name: "test-key",
      key: "test-api-key",
      isEnabled: true,
      canLoginWebUi: false,
      limit5hUsd: 10.0,
      limitWeeklyUsd: 50.0,
      limitMonthlyUsd: 200.0,
      limitConcurrentSessions: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const session = {
      authState: {
        user: overrides.user === null ? null : { ...defaultUser, ...overrides.user },
        key: overrides.key === null ? null : { ...defaultKey, ...overrides.key },
        apiKey: "test-api-key",
        success: true,
      },
    } as ProxySession;

    return session;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ensure()", () => {
    describe("authentication state validation", () => {
      it("should return null when user is missing", async () => {
        const session = createMockSession({ user: null });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkUserRPM).not.toHaveBeenCalled();
      });

      it("should return null when key is missing", async () => {
        const session = createMockSession({ key: null });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkUserRPM).not.toHaveBeenCalled();
      });

      it("should return null when both user and key are missing", async () => {
        const session = createMockSession({ user: null, key: null });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkUserRPM).not.toHaveBeenCalled();
      });
    });

    describe("user RPM rate limiting", () => {
      it("should pass when RPM limit is not exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
          current: 50,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
          current: 10.0,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkSessionLimit).mockResolvedValue({
          allowed: true,
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkUserRPM).toHaveBeenCalledWith(1, 100);
      });

      it("should return 429 response when RPM limit is exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: false,
          reason: "用户每分钟请求数上限已达到（100/100）",
          current: 100,
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeInstanceOf(Response);
        expect(result?.status).toBe(429);
        expect(result?.headers.get("X-RateLimit-Type")).toBe("user");
        expect(result?.headers.get("Retry-After")).toBe("3600");

        const body = await result?.json();
        expect(body).toEqual({
          error: {
            type: "rate_limit_error",
            message: "用户限流：用户每分钟请求数上限已达到（100/100）",
          },
        });

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("[RateLimit] User RPM exceeded")
        );
      });
    });

    describe("user daily cost rate limiting", () => {
      it("should pass when daily quota is not exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
          current: 25.0,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkSessionLimit).mockResolvedValue({
          allowed: true,
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkUserDailyCost).toHaveBeenCalledWith(1, 50.0);
      });

      it("should return 429 response when daily quota is exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: false,
          reason: "用户每日消费上限已达到（$50.0000/$50.0）",
          current: 50.0,
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeInstanceOf(Response);
        expect(result?.status).toBe(429);

        const body = await result?.json();
        expect(body.error.message).toContain("用户限流");
        expect(body.error.message).toContain("用户每日消费上限已达到");
      });
    });

    describe("key cost rate limiting", () => {
      it("should pass when key cost limits are not exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkSessionLimit).mockResolvedValue({
          allowed: true,
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkCostLimits).toHaveBeenCalledWith(1, "key", {
          limit_5h_usd: 10.0,
          limit_weekly_usd: 50.0,
          limit_monthly_usd: 200.0,
        });
      });

      it("should return 429 response when 5h cost limit is exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: false,
          reason: "Key 5小时消费上限已达到（10.0000/10.0）",
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeInstanceOf(Response);
        expect(result?.status).toBe(429);
        expect(result?.headers.get("X-RateLimit-Type")).toBe("key");

        const body = await result?.json();
        expect(body.error.message).toContain("Key 限流");
        expect(body.error.message).toContain("5小时消费上限已达到");
      });

      it("should return 429 response when weekly cost limit is exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: false,
          reason: "Key 周消费上限已达到（50.0000/50.0）",
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeInstanceOf(Response);
        expect(result?.status).toBe(429);

        const body = await result?.json();
        expect(body.error.message).toContain("周消费上限已达到");
      });

      it("should return 429 response when monthly cost limit is exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: false,
          reason: "Key 月消费上限已达到（200.0000/200.0）",
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeInstanceOf(Response);
        expect(result?.status).toBe(429);

        const body = await result?.json();
        expect(body.error.message).toContain("月消费上限已达到");
      });
    });

    describe("key session rate limiting", () => {
      it("should pass when session limit is not exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkSessionLimit).mockResolvedValue({
          allowed: true,
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkSessionLimit).toHaveBeenCalledWith(1, "key", 5);
      });

      it("should return 429 response when session limit is exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkSessionLimit).mockResolvedValue({
          allowed: false,
          reason: "Key并发 Session 上限已达到（5/5）",
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeInstanceOf(Response);
        expect(result?.status).toBe(429);
        expect(result?.headers.get("X-RateLimit-Type")).toBe("key");

        const body = await result?.json();
        expect(body.error.message).toContain("Key 限流");
        expect(body.error.message).toContain("并发 Session 上限已达到");
      });

      it("should handle zero or null session limits", async () => {
        const session = createMockSession({
          key: { limitConcurrentSessions: 0 },
        });

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkSessionLimit).mockResolvedValue({
          allowed: true,
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkSessionLimit).toHaveBeenCalledWith(1, "key", 0);
      });
    });

    describe("rate limit check order", () => {
      it("should check in correct order: user RPM → user daily → key cost → key session", async () => {
        const session = createMockSession();
        const checkOrder: string[] = [];

        vi.mocked(RateLimitService.checkUserRPM).mockImplementation(async () => {
          checkOrder.push("user-rpm");
          return { allowed: true };
        });

        vi.mocked(RateLimitService.checkUserDailyCost).mockImplementation(async () => {
          checkOrder.push("user-daily");
          return { allowed: true };
        });

        vi.mocked(RateLimitService.checkCostLimits).mockImplementation(async () => {
          checkOrder.push("key-cost");
          return { allowed: true };
        });

        vi.mocked(RateLimitService.checkSessionLimit).mockImplementation(async () => {
          checkOrder.push("key-session");
          return { allowed: true };
        });

        await ProxyRateLimitGuard.ensure(session);

        expect(checkOrder).toEqual(["user-rpm", "user-daily", "key-cost", "key-session"]);
      });

      it("should stop at first failure and not check subsequent limits", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });

        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: false,
          reason: "Daily limit exceeded",
        });

        await ProxyRateLimitGuard.ensure(session);

        expect(RateLimitService.checkUserRPM).toHaveBeenCalled();
        expect(RateLimitService.checkUserDailyCost).toHaveBeenCalled();
        expect(RateLimitService.checkCostLimits).not.toHaveBeenCalled();
        expect(RateLimitService.checkSessionLimit).not.toHaveBeenCalled();
      });
    });

    describe("error handling and fallback", () => {
      it("should handle errors from checkUserRPM gracefully", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockRejectedValue(
          new Error("Redis connection failed")
        );

        await expect(ProxyRateLimitGuard.ensure(session)).rejects.toThrow(
          "Redis connection failed"
        );
      });

      it("should handle errors from checkCostLimits gracefully", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockRejectedValue(
          new Error("Database query failed")
        );

        await expect(ProxyRateLimitGuard.ensure(session)).rejects.toThrow("Database query failed");
      });
    });

    describe("response format validation", () => {
      it("should return proper 429 response with correct headers and body", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: false,
          reason: "Rate limit exceeded",
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        // Validate response status
        expect(result?.status).toBe(429);

        // Validate headers
        expect(result?.headers.get("Content-Type")).toBe("application/json");
        expect(result?.headers.get("X-RateLimit-Type")).toBe("user");
        expect(result?.headers.get("Retry-After")).toBe("3600");

        // Validate body structure
        const body = await result?.json();
        expect(body).toHaveProperty("error");
        expect(body.error).toHaveProperty("type");
        expect(body.error).toHaveProperty("message");
        expect(body.error.type).toBe("rate_limit_error");
      });

      it("should differentiate between user and key rate limit types in response", async () => {
        const session = createMockSession();

        // Test user rate limit
        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: false,
          reason: "User rate limit",
        });

        const userResult = await ProxyRateLimitGuard.ensure(session);
        expect(userResult?.headers.get("X-RateLimit-Type")).toBe("user");
        const userBody = await userResult?.json();
        expect(userBody.error.message).toContain("用户限流");

        // Reset and test key rate limit
        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: false,
          reason: "Key rate limit",
        });

        const keyResult = await ProxyRateLimitGuard.ensure(session);
        expect(keyResult?.headers.get("X-RateLimit-Type")).toBe("key");
        const keyBody = await keyResult?.json();
        expect(keyBody.error.message).toContain("Key 限流");
      });
    });

    describe("edge cases", () => {
      it("should handle null cost limits gracefully", async () => {
        const session = createMockSession({
          key: {
            limit5hUsd: null,
            limitWeeklyUsd: null,
            limitMonthlyUsd: null,
          },
        });

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkSessionLimit).mockResolvedValue({
          allowed: true,
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkCostLimits).toHaveBeenCalledWith(1, "key", {
          limit_5h_usd: null,
          limit_weekly_usd: null,
          limit_monthly_usd: null,
        });
      });

      it("should handle zero RPM limit", async () => {
        const session = createMockSession({
          user: { rpm: 0 },
        });

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkSessionLimit).mockResolvedValue({
          allowed: true,
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkUserRPM).toHaveBeenCalledWith(1, 0);
      });

      it("should handle zero daily quota", async () => {
        const session = createMockSession({
          user: { dailyQuota: 0 },
        });

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkSessionLimit).mockResolvedValue({
          allowed: true,
        });

        const result = await ProxyRateLimitGuard.ensure(session);

        expect(result).toBeNull();
        expect(RateLimitService.checkUserDailyCost).toHaveBeenCalledWith(1, 0);
      });
    });

    describe("logging", () => {
      it("should log warning when user RPM is exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: false,
          reason: "RPM limit exceeded",
        });

        await ProxyRateLimitGuard.ensure(session);

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringMatching(/\[RateLimit\] User RPM exceeded: user=1, RPM limit exceeded/)
        );
      });

      it("should log warning when user daily cost is exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: false,
          reason: "Daily cost exceeded",
        });

        await ProxyRateLimitGuard.ensure(session);

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringMatching(
            /\[RateLimit\] User daily limit exceeded: user=1, Daily cost exceeded/
          )
        );
      });

      it("should log warning when key cost limit is exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: false,
          reason: "Cost limit exceeded",
        });

        await ProxyRateLimitGuard.ensure(session);

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringMatching(/\[RateLimit\] Key cost limit exceeded: key=1, Cost limit exceeded/)
        );
      });

      it("should log warning when key session limit is exceeded", async () => {
        const session = createMockSession();

        vi.mocked(RateLimitService.checkUserRPM).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkUserDailyCost).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({
          allowed: true,
        });
        vi.mocked(RateLimitService.checkSessionLimit).mockResolvedValue({
          allowed: false,
          reason: "Session limit exceeded",
        });

        await ProxyRateLimitGuard.ensure(session);

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringMatching(
            /\[RateLimit\] Key session limit exceeded: key=1, Session limit exceeded/
          )
        );
      });
    });
  });
});
