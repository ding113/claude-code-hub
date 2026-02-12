import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for SESSION_TTL environment variable validation
 *
 * These tests verify that invalid SESSION_TTL values (NaN, 0, negative)
 * are properly handled with fallback to default 300 seconds.
 */

let redisClientRef: any;
const pipelineCalls: Array<unknown[]> = [];

const makePipeline = () => {
  const pipeline = {
    zadd: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["zadd", ...args]);
      return pipeline;
    }),
    expire: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["expire", ...args]);
      return pipeline;
    }),
    setex: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["setex", ...args]);
      return pipeline;
    }),
    zremrangebyscore: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["zremrangebyscore", ...args]);
      return pipeline;
    }),
    zrange: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["zrange", ...args]);
      return pipeline;
    }),
    exists: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["exists", ...args]);
      return pipeline;
    }),
    exec: vi.fn(async () => {
      pipelineCalls.push(["exec"]);
      return [];
    }),
  };
  return pipeline;
};

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClientRef,
}));

describe("SESSION_TTL environment variable validation", () => {
  const nowMs = 1_700_000_000_000;
  const ORIGINAL_SESSION_TTL = process.env.SESSION_TTL;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    pipelineCalls.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));

    redisClientRef = {
      status: "ready",
      exists: vi.fn(async () => 1),
      type: vi.fn(async () => "zset"),
      del: vi.fn(async () => 1),
      zremrangebyscore: vi.fn(async () => 0),
      zrange: vi.fn(async () => []),
      pipeline: vi.fn(() => makePipeline()),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_SESSION_TTL === undefined) {
      delete process.env.SESSION_TTL;
    } else {
      process.env.SESSION_TTL = ORIGINAL_SESSION_TTL;
    }
  });

  describe("SessionTracker TTL parsing", () => {
    it("should use default 300 when SESSION_TTL is empty string", async () => {
      process.env.SESSION_TTL = "";
      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.getGlobalSessionCount();

      // Default: 300 seconds = 300000 ms
      const expectedCutoff = nowMs - 300 * 1000;
      expect(redisClientRef.zremrangebyscore).toHaveBeenCalledWith(
        "{active_sessions}:global:active_sessions",
        "-inf",
        expectedCutoff
      );
    });

    it("should use default 300 when SESSION_TTL is NaN", async () => {
      process.env.SESSION_TTL = "not-a-number";
      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.getGlobalSessionCount();

      const expectedCutoff = nowMs - 300 * 1000;
      expect(redisClientRef.zremrangebyscore).toHaveBeenCalledWith(
        "{active_sessions}:global:active_sessions",
        "-inf",
        expectedCutoff
      );
    });

    it("should use default 300 when SESSION_TTL is 0", async () => {
      process.env.SESSION_TTL = "0";
      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.getGlobalSessionCount();

      const expectedCutoff = nowMs - 300 * 1000;
      expect(redisClientRef.zremrangebyscore).toHaveBeenCalledWith(
        "{active_sessions}:global:active_sessions",
        "-inf",
        expectedCutoff
      );
    });

    it("should use default 300 when SESSION_TTL is negative", async () => {
      process.env.SESSION_TTL = "-100";
      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.getGlobalSessionCount();

      const expectedCutoff = nowMs - 300 * 1000;
      expect(redisClientRef.zremrangebyscore).toHaveBeenCalledWith(
        "{active_sessions}:global:active_sessions",
        "-inf",
        expectedCutoff
      );
    });

    it("should use provided value when SESSION_TTL is valid positive integer", async () => {
      process.env.SESSION_TTL = "600";
      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.getGlobalSessionCount();

      // Custom: 600 seconds = 600000 ms
      const expectedCutoff = nowMs - 600 * 1000;
      expect(redisClientRef.zremrangebyscore).toHaveBeenCalledWith(
        "{active_sessions}:global:active_sessions",
        "-inf",
        expectedCutoff
      );
    });
  });
});
