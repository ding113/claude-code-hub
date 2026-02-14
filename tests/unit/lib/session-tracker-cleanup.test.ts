import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGlobalActiveSessionsKey } from "@/lib/redis/active-session-keys";

let redisClientRef: any;
const pipelineCalls: Array<unknown[]> = [];

/**
 * 构造一个可记录调用的 Redis pipeline mock（用于断言 cleanup/expire 等行为）。
 */
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

describe("SessionTracker - TTL and cleanup", () => {
  const nowMs = 1_700_000_000_000;
  const globalKey = getGlobalActiveSessionsKey();
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

  describe("env-driven TTL", () => {
    it("should use SESSION_TTL env (seconds) converted to ms for cutoff calculation", async () => {
      // Set SESSION_TTL to 600 seconds (10 minutes)
      process.env.SESSION_TTL = "600";

      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.getGlobalSessionCount();

      // Should call zremrangebyscore with cutoff = now - 600*1000 = now - 600000
      const expectedCutoff = nowMs - 600 * 1000;
      expect(redisClientRef.zremrangebyscore).toHaveBeenCalledWith(
        globalKey,
        "-inf",
        expectedCutoff
      );
    });

    it("should default to 300 seconds (5 min) when SESSION_TTL not set", async () => {
      delete process.env.SESSION_TTL;

      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.getGlobalSessionCount();

      // Default: 300 seconds = 300000 ms
      const expectedCutoff = nowMs - 300 * 1000;
      expect(redisClientRef.zremrangebyscore).toHaveBeenCalledWith(
        globalKey,
        "-inf",
        expectedCutoff
      );
    });
  });

  describe("refreshSession - provider ZSET EXPIRE", () => {
    it("should set EXPIRE on provider ZSET with fallback TTL 3600", async () => {
      process.env.SESSION_TTL = "300";

      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.refreshSession("sess-123", 1, 42);

      // Check pipeline calls include expire for provider ZSET
      const providerExpireCall = pipelineCalls.find(
        (call) => call[0] === "expire" && String(call[1]).includes("provider:42:active_sessions")
      );
      expect(providerExpireCall).toBeDefined();
      expect(providerExpireCall![2]).toBe(3600); // fallback TTL
    });

    it("should use SESSION_TTL when it exceeds 3600s for provider ZSET EXPIRE", async () => {
      process.env.SESSION_TTL = "7200"; // 2 hours > 3600

      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.refreshSession("sess-123", 1, 42);

      // Check pipeline calls include expire for provider ZSET with dynamic TTL
      const providerExpireCall = pipelineCalls.find(
        (call) => call[0] === "expire" && String(call[1]).includes("provider:42:active_sessions")
      );
      expect(providerExpireCall).toBeDefined();
      expect(providerExpireCall![2]).toBe(7200); // should use SESSION_TTL when > 3600
    });

    it("should refresh session binding TTLs using env SESSION_TTL (not hardcoded 300)", async () => {
      process.env.SESSION_TTL = "600"; // 10 minutes

      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.refreshSession("sess-123", 1, 42);

      // Check expire calls for session bindings use 600 (env value), not 300
      const providerBindingExpire = pipelineCalls.find(
        (call) => call[0] === "expire" && String(call[1]) === "session:sess-123:provider"
      );
      const keyBindingExpire = pipelineCalls.find(
        (call) => call[0] === "expire" && String(call[1]) === "session:sess-123:key"
      );
      const lastSeenSetex = pipelineCalls.find(
        (call) => call[0] === "setex" && String(call[1]) === "session:sess-123:last_seen"
      );

      expect(providerBindingExpire).toBeDefined();
      expect(providerBindingExpire![2]).toBe(600);

      expect(keyBindingExpire).toBeDefined();
      expect(keyBindingExpire![2]).toBe(600);

      expect(lastSeenSetex).toBeDefined();
      expect(lastSeenSetex![2]).toBe(600);
    });
  });

  describe("refreshSession - probabilistic cleanup on write path", () => {
    it("should perform ZREMRANGEBYSCORE cleanup when probability gate hits", async () => {
      process.env.SESSION_TTL = "300";

      // Mock Math.random to always return 0 (below default 0.01 threshold)
      vi.spyOn(Math, "random").mockReturnValue(0);

      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.refreshSession("sess-123", 1, 42);

      // Should have zremrangebyscore call for provider ZSET cleanup
      const cleanupCall = pipelineCalls.find(
        (call) =>
          call[0] === "zremrangebyscore" && String(call[1]).includes("provider:42:active_sessions")
      );
      expect(cleanupCall).toBeDefined();

      // Cutoff should be now - SESSION_TTL_MS
      const expectedCutoff = nowMs - 300 * 1000;
      expect(cleanupCall![2]).toBe("-inf");
      expect(cleanupCall![3]).toBe(expectedCutoff);
    });

    it("should skip cleanup when probability gate does not hit", async () => {
      process.env.SESSION_TTL = "300";

      // Mock Math.random to return 0.5 (above default 0.01 threshold)
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.refreshSession("sess-123", 1, 42);

      // Should NOT have zremrangebyscore call
      const cleanupCall = pipelineCalls.find((call) => call[0] === "zremrangebyscore");
      expect(cleanupCall).toBeUndefined();
    });

    it("should use env-driven TTL for cleanup cutoff calculation", async () => {
      process.env.SESSION_TTL = "600"; // 10 minutes

      vi.spyOn(Math, "random").mockReturnValue(0);

      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.refreshSession("sess-123", 1, 42);

      const cleanupCall = pipelineCalls.find(
        (call) =>
          call[0] === "zremrangebyscore" && String(call[1]).includes("provider:42:active_sessions")
      );
      expect(cleanupCall).toBeDefined();

      // Cutoff should be now - 600*1000
      const expectedCutoff = nowMs - 600 * 1000;
      expect(cleanupCall![3]).toBe(expectedCutoff);
    });
  });

  describe("countFromZSet - env-driven TTL", () => {
    it("should use env SESSION_TTL for cleanup cutoff in batch count", async () => {
      process.env.SESSION_TTL = "600";

      const { SessionTracker } = await import("@/lib/session-tracker");

      // getProviderSessionCountBatch uses SESSION_TTL internally
      await SessionTracker.getProviderSessionCountBatch([1, 2]);

      // Check pipeline zremrangebyscore calls use correct cutoff
      const cleanupCalls = pipelineCalls.filter((call) => call[0] === "zremrangebyscore");
      expect(cleanupCalls.length).toBeGreaterThan(0);

      const expectedCutoff = nowMs - 600 * 1000;
      for (const call of cleanupCalls) {
        expect(call[3]).toBe(expectedCutoff);
      }
    });
  });

  describe("getActiveSessions - env-driven TTL", () => {
    it("should use env SESSION_TTL for cleanup cutoff", async () => {
      process.env.SESSION_TTL = "600";

      const { SessionTracker } = await import("@/lib/session-tracker");

      await SessionTracker.getActiveSessions();

      const expectedCutoff = nowMs - 600 * 1000;
      expect(redisClientRef.zremrangebyscore).toHaveBeenCalledWith(
        globalKey,
        "-inf",
        expectedCutoff
      );
    });
  });

  describe("Fail-Open behavior", () => {
    it("refreshSession should not throw when Redis is not ready", async () => {
      redisClientRef.status = "end";

      const { SessionTracker } = await import("@/lib/session-tracker");

      await expect(SessionTracker.refreshSession("sess-123", 1, 42)).resolves.toBeUndefined();
    });

    it("refreshSession should not throw when Redis is null", async () => {
      redisClientRef = null;

      const { SessionTracker } = await import("@/lib/session-tracker");

      await expect(SessionTracker.refreshSession("sess-123", 1, 42)).resolves.toBeUndefined();
    });
  });
});
