import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -- mocks --

const mocks = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  getRedisClient: vi.fn(),
  APP_VERSION: "v0.6.8",
  v1App: {
    request: vi.fn(),
  },
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/drizzle/db", () => ({
  db: { execute: mocks.dbExecute },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray) => strings.join(""),
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: mocks.getRedisClient,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock("@/lib/version", () => ({
  APP_VERSION: mocks.APP_VERSION,
}));

vi.mock("@/app/v1/[...route]/route", () => ({
  v1App: mocks.v1App,
}));

// -- tests --

const originalDsn = process.env.DSN;
const originalRedisUrl = process.env.REDIS_URL;

describe("health/checker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.DSN;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    if (originalDsn === undefined) {
      delete process.env.DSN;
    } else {
      process.env.DSN = originalDsn;
    }

    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  // -- getAppVersion --

  describe("getAppVersion", () => {
    it("returns version without v prefix", async () => {
      const { getAppVersion } = await import("@/lib/health/checker");
      expect(getAppVersion()).toBe("0.6.8");
    });
  });

  // -- checkDatabase --

  describe("checkDatabase", () => {
    it("returns unchecked when DSN is not set", async () => {
      delete process.env.DSN;
      const { checkDatabase } = await import("@/lib/health/checker");
      const result = await checkDatabase();
      expect(result.status).toBe("unchecked");
      expect(result.message).toContain("not configured");
    });

    it("returns up when SELECT 1 succeeds", async () => {
      process.env.DSN = "postgres://test";
      mocks.dbExecute.mockResolvedValue([{ "?column?": 1 }]);
      const { checkDatabase } = await import("@/lib/health/checker");
      const result = await checkDatabase();
      expect(result.status).toBe("up");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns down when query throws", async () => {
      process.env.DSN = "postgres://test";
      mocks.dbExecute.mockRejectedValue(new Error("connection refused"));
      const { checkDatabase } = await import("@/lib/health/checker");
      const result = await checkDatabase();
      expect(result.status).toBe("down");
      expect(result.message).toBe("Database connection failed");
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        "[Health] database check failed",
        expect.objectContaining({ error: "connection refused" })
      );
    });

    it("returns down on timeout", async () => {
      process.env.DSN = "postgres://test";
      mocks.dbExecute.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5_000))
      );
      const { checkDatabase } = await import("@/lib/health/checker");
      const result = await checkDatabase();
      expect(result.status).toBe("down");
      expect(result.message).toBe("Database connection failed");
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        "[Health] database check failed",
        expect.objectContaining({ error: expect.stringContaining("timed out") })
      );
    }, 10_000);
  });

  // -- checkRedis --

  describe("checkRedis", () => {
    it("returns up when ping succeeds", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.getRedisClient.mockReturnValue({
        status: "ready",
        ping: vi.fn().mockResolvedValue("PONG"),
      });
      const { checkRedis } = await import("@/lib/health/checker");
      const result = await checkRedis();
      expect(result.status).toBe("up");
    });

    it("returns unchecked when REDIS_URL is not set", async () => {
      delete process.env.REDIS_URL;
      mocks.getRedisClient.mockReturnValue(null);
      const { checkRedis } = await import("@/lib/health/checker");
      const result = await checkRedis();
      expect(result.status).toBe("unchecked");
      expect(result.message).toContain("not configured");
    });

    it("returns down when REDIS_URL is set but client is null", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.getRedisClient.mockReturnValue(null);
      const { checkRedis } = await import("@/lib/health/checker");
      const result = await checkRedis();
      expect(result.status).toBe("down");
      expect(result.message).toContain("initialization failed");
    });

    it("returns down when client status is end", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.getRedisClient.mockReturnValue({ status: "end" });
      const { checkRedis } = await import("@/lib/health/checker");
      const result = await checkRedis();
      expect(result.status).toBe("down");
      expect(result.message).toContain("end");
    });

    it("returns down when client status is close", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.getRedisClient.mockReturnValue({ status: "close" });
      const { checkRedis } = await import("@/lib/health/checker");
      const result = await checkRedis();
      expect(result.status).toBe("down");
      expect(result.message).toContain("close");
    });

    it("returns down when ping throws", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.getRedisClient.mockReturnValue({
        status: "ready",
        ping: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      });
      const { checkRedis } = await import("@/lib/health/checker");
      const result = await checkRedis();
      expect(result.status).toBe("down");
      expect(result.message).toBe("Redis connection failed");
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        "[Health] redis check failed",
        expect.objectContaining({ error: "ECONNRESET" })
      );
    });

    it("returns down on ping timeout", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.getRedisClient.mockReturnValue({
        status: "ready",
        ping: vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 5_000))),
      });
      const { checkRedis } = await import("@/lib/health/checker");
      const result = await checkRedis();
      expect(result.status).toBe("down");
      expect(result.message).toBe("Redis connection failed");
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        "[Health] redis check failed",
        expect.objectContaining({ error: expect.stringContaining("timed out") })
      );
    }, 10_000);
  });

  // -- checkProxy --

  describe("checkProxy", () => {
    it("returns up when _ping returns 200", async () => {
      mocks.v1App.request.mockResolvedValue(new Response('{"status":"pong"}', { status: 200 }));
      const { checkProxy } = await import("@/lib/health/checker");
      const result = await checkProxy();
      expect(result.status).toBe("up");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns down when _ping returns non-200", async () => {
      mocks.v1App.request.mockResolvedValue(new Response("error", { status: 500 }));
      const { checkProxy } = await import("@/lib/health/checker");
      const result = await checkProxy();
      expect(result.status).toBe("down");
      expect(result.message).toContain("HTTP 500");
    });

    it("returns down when request throws", async () => {
      mocks.v1App.request.mockRejectedValue(new Error("middleware crashed"));
      const { checkProxy } = await import("@/lib/health/checker");
      const result = await checkProxy();
      expect(result.status).toBe("down");
      expect(result.message).toBe("Proxy request failed");
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        "[Health] proxy check failed",
        expect.objectContaining({ error: "middleware crashed" })
      );
    });

    it("returns down on timeout", async () => {
      mocks.v1App.request.mockImplementation(() => new Promise((r) => setTimeout(r, 5_000)));
      const { checkProxy } = await import("@/lib/health/checker");
      const result = await checkProxy();
      expect(result.status).toBe("down");
      expect(result.message).toBe("Proxy request failed");
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        "[Health] proxy check failed",
        expect.objectContaining({ error: expect.stringContaining("timed out") })
      );
    }, 10_000);
  });

  // -- checkReadiness --

  describe("checkReadiness", () => {
    it("returns healthy when all components are up", async () => {
      process.env.DSN = "postgres://test";
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.dbExecute.mockResolvedValue([{ "?column?": 1 }]);
      mocks.getRedisClient.mockReturnValue({
        status: "ready",
        ping: vi.fn().mockResolvedValue("PONG"),
      });
      mocks.v1App.request.mockResolvedValue(new Response('{"status":"pong"}', { status: 200 }));
      const { checkReadiness } = await import("@/lib/health/checker");
      const result = await checkReadiness();
      expect(result.status).toBe("healthy");
      expect(result.version).toBe("0.6.8");
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.components?.database?.status).toBe("up");
      expect(result.components?.redis?.status).toBe("up");
      expect(result.components?.proxy?.status).toBe("up");
    });

    it("returns degraded when Redis is down but DB and proxy are up", async () => {
      process.env.DSN = "postgres://test";
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.dbExecute.mockResolvedValue([{ "?column?": 1 }]);
      mocks.getRedisClient.mockReturnValue({
        status: "ready",
        ping: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      });
      mocks.v1App.request.mockResolvedValue(new Response('{"status":"pong"}', { status: 200 }));
      const { checkReadiness } = await import("@/lib/health/checker");
      const result = await checkReadiness();
      expect(result.status).toBe("degraded");
      expect(result.components?.database?.status).toBe("up");
      expect(result.components?.redis?.status).toBe("down");
    });

    it("returns degraded when proxy is down but DB and Redis are up", async () => {
      process.env.DSN = "postgres://test";
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.dbExecute.mockResolvedValue([{ "?column?": 1 }]);
      mocks.getRedisClient.mockReturnValue({
        status: "ready",
        ping: vi.fn().mockResolvedValue("PONG"),
      });
      mocks.v1App.request.mockRejectedValue(new Error("middleware crashed"));
      const { checkReadiness } = await import("@/lib/health/checker");
      const result = await checkReadiness();
      expect(result.status).toBe("degraded");
      expect(result.components?.proxy?.status).toBe("down");
    });

    it("returns unhealthy when DB is down", async () => {
      process.env.DSN = "postgres://test";
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.dbExecute.mockRejectedValue(new Error("connection refused"));
      mocks.getRedisClient.mockReturnValue({
        status: "ready",
        ping: vi.fn().mockResolvedValue("PONG"),
      });
      mocks.v1App.request.mockResolvedValue(new Response('{"status":"pong"}', { status: 200 }));
      const { checkReadiness } = await import("@/lib/health/checker");
      const result = await checkReadiness();
      expect(result.status).toBe("unhealthy");
      expect(result.components?.database?.status).toBe("down");
    });

    it("returns healthy when Redis is unchecked (not configured)", async () => {
      process.env.DSN = "postgres://test";
      mocks.dbExecute.mockResolvedValue([{ "?column?": 1 }]);
      mocks.getRedisClient.mockReturnValue(null);
      mocks.v1App.request.mockResolvedValue(new Response('{"status":"pong"}', { status: 200 }));
      const { checkReadiness } = await import("@/lib/health/checker");
      const result = await checkReadiness();
      expect(result.status).toBe("healthy");
      expect(result.components?.redis?.status).toBe("unchecked");
    });

    it("returns healthy when DB is unchecked in test mode", async () => {
      process.env.REDIS_URL = "redis://localhost:6379";
      mocks.getRedisClient.mockReturnValue({
        status: "ready",
        ping: vi.fn().mockResolvedValue("PONG"),
      });
      mocks.v1App.request.mockResolvedValue(new Response('{"status":"pong"}', { status: 200 }));
      const { checkReadiness } = await import("@/lib/health/checker");
      const result = await checkReadiness();
      expect(result.status).toBe("healthy");
      expect(result.components?.database?.status).toBe("unchecked");
      expect(result.components?.redis?.status).toBe("up");
    });
  });
});
