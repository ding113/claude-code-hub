import { beforeEach, describe, expect, it, vi } from "vitest";

let redisClientRef: any;
let pipelineRef: any;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClientRef,
}));

describe("SessionManager.terminateSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    pipelineRef = {
      del: vi.fn(() => pipelineRef),
      zrem: vi.fn(() => pipelineRef),
      exec: vi.fn(async () => [[null, 1]]),
    };

    redisClientRef = {
      status: "ready",
      get: vi.fn(async () => null),
      hget: vi.fn(async () => null),
      pipeline: vi.fn(() => pipelineRef),
    };
  });

  it("应同时从 global/key/user 的 active_sessions ZSET 中移除 sessionId（若可解析到 userId）", async () => {
    const sessionId = "sess_test";
    redisClientRef.get.mockImplementation(async (key: string) => {
      if (key === `session:${sessionId}:provider`) return "42";
      if (key === `session:${sessionId}:key`) return "7";
      return null;
    });
    redisClientRef.hget.mockImplementation(async (key: string, field: string) => {
      if (key === `session:${sessionId}:info` && field === "userId") return "123";
      return null;
    });

    const { getGlobalActiveSessionsKey, getKeyActiveSessionsKey, getUserActiveSessionsKey } =
      await import("@/lib/redis/active-session-keys");
    const { SessionManager } = await import("@/lib/session-manager");

    const ok = await SessionManager.terminateSession(sessionId);
    expect(ok).toBe(true);

    expect(redisClientRef.hget).toHaveBeenCalledWith(`session:${sessionId}:info`, "userId");

    expect(pipelineRef.zrem).toHaveBeenCalledWith(getGlobalActiveSessionsKey(), sessionId);
    expect(pipelineRef.zrem).toHaveBeenCalledWith("provider:42:active_sessions", sessionId);
    expect(pipelineRef.zrem).toHaveBeenCalledWith(getKeyActiveSessionsKey(7), sessionId);
    expect(pipelineRef.zrem).toHaveBeenCalledWith(getUserActiveSessionsKey(123), sessionId);
  });

  it("当 userId 不可用时，不应尝试 zrem user active_sessions key", async () => {
    const sessionId = "sess_test";
    redisClientRef.get.mockImplementation(async (key: string) => {
      if (key === `session:${sessionId}:provider`) return "42";
      if (key === `session:${sessionId}:key`) return "7";
      return null;
    });
    redisClientRef.hget.mockResolvedValue(null);

    const { getUserActiveSessionsKey } = await import("@/lib/redis/active-session-keys");
    const { SessionManager } = await import("@/lib/session-manager");

    const ok = await SessionManager.terminateSession(sessionId);
    expect(ok).toBe(true);

    expect(pipelineRef.zrem).not.toHaveBeenCalledWith(getUserActiveSessionsKey(123), sessionId);
  });
});
