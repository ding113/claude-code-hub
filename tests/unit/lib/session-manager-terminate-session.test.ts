import { beforeEach, describe, expect, it, vi } from "vitest";

let redisClientRef: any;
let pipelineRef: any;
let deletePipelineRef: any;

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
      zrem: vi.fn(() => pipelineRef),
      exec: vi.fn(async () => []),
    };

    deletePipelineRef = {
      del: vi.fn(() => deletePipelineRef),
      exec: vi.fn(async () => [[null, 1]]),
    };

    redisClientRef = {
      status: "ready",
      set: vi.fn(async () => "OK"),
      get: vi.fn(async () => null),
      hget: vi.fn(async () => null),
      scan: vi.fn(async () => ["0", []]),
      pipeline: vi
        .fn()
        // 第一次 pipeline：用于 ZSET 清理（global/key/provider/user）
        .mockImplementationOnce(() => pipelineRef)
        // 后续 pipeline：用于批量删除 session:{id}:* key（可能多页 SCAN）
        .mockImplementation(() => deletePipelineRef),
    };
  });

  it("应同时从 global/key/user 的 active_sessions ZSET 中移除 sessionId（若可解析到 userId）", async () => {
    const sessionId = "sess_te*st?[x]";
    const terminatedKey = `session:${sessionId}:terminated`;
    redisClientRef.get.mockImplementation(async (key: string) => {
      if (key === `session:${sessionId}:provider`) return "42";
      if (key === `session:${sessionId}:key`) return "7";
      return null;
    });
    redisClientRef.hget.mockImplementation(async (key: string, field: string) => {
      if (key === `session:${sessionId}:info` && field === "userId") return "123";
      return null;
    });
    redisClientRef.scan.mockResolvedValueOnce([
      "0",
      [
        terminatedKey,
        `session:${sessionId}:provider`,
        `session:${sessionId}:req:1:messages`,
        `session:${sessionId}:req:1:response`,
      ],
    ]);

    const { getGlobalActiveSessionsKey, getKeyActiveSessionsKey, getUserActiveSessionsKey } =
      await import("@/lib/redis/active-session-keys");
    const { SessionManager } = await import("@/lib/session-manager");

    const result = await SessionManager.terminateSession(sessionId);
    expect(result.markerOk).toBe(true);

    expect(redisClientRef.set).toHaveBeenCalledWith(terminatedKey, expect.any(String), "EX", 86400);
    expect(redisClientRef.hget).toHaveBeenCalledWith(`session:${sessionId}:info`, "userId");

    expect(pipelineRef.zrem).toHaveBeenCalledWith(getGlobalActiveSessionsKey(), sessionId);
    expect(pipelineRef.zrem).toHaveBeenCalledWith("provider:42:active_sessions", sessionId);
    expect(pipelineRef.zrem).toHaveBeenCalledWith(getKeyActiveSessionsKey(7), sessionId);
    expect(pipelineRef.zrem).toHaveBeenCalledWith(getUserActiveSessionsKey(123), sessionId);

    expect(deletePipelineRef.del).toHaveBeenCalledWith(`session:${sessionId}:provider`);
    expect(deletePipelineRef.del).toHaveBeenCalledWith(`session:${sessionId}:req:1:messages`);
    expect(deletePipelineRef.del).toHaveBeenCalledWith(`session:${sessionId}:req:1:response`);
    expect(deletePipelineRef.del).not.toHaveBeenCalledWith(terminatedKey);

    // 安全性：SCAN MATCH pattern 必须按字面量匹配 sessionId，避免 glob 注入误删其它 key
    expect(redisClientRef.scan).toHaveBeenCalledWith(
      "0",
      "MATCH",
      "session:sess_te\\*st\\?\\[x\\]:*",
      "COUNT",
      200
    );
  });

  it("当 userId 不可用时，不应尝试 zrem user active_sessions key", async () => {
    const sessionId = "sess_test";
    const terminatedKey = `session:${sessionId}:terminated`;
    redisClientRef.get.mockImplementation(async (key: string) => {
      if (key === `session:${sessionId}:provider`) return "42";
      if (key === `session:${sessionId}:key`) return "7";
      return null;
    });
    redisClientRef.hget.mockResolvedValue(null);
    redisClientRef.scan.mockResolvedValueOnce(["0", [terminatedKey]]);

    const { getUserActiveSessionsKey } = await import("@/lib/redis/active-session-keys");
    const { SessionManager } = await import("@/lib/session-manager");

    const result = await SessionManager.terminateSession(sessionId);
    expect(result.markerOk).toBe(true);

    // SCAN 仅返回 terminatedKey 时，不会发出任何 DEL 命令，因此不应执行 delete pipeline（避免不必要的网络开销）。
    expect(deletePipelineRef.exec).not.toHaveBeenCalled();
    expect(pipelineRef.zrem).not.toHaveBeenCalledWith(getUserActiveSessionsKey(123), sessionId);
  });

  it("当终止标记写入失败时，markerOk 应为 false（但清理仍会执行）", async () => {
    const sessionId = "sess_marker_fail";
    redisClientRef.set.mockResolvedValueOnce(null);
    redisClientRef.scan.mockResolvedValueOnce(["0", [`session:${sessionId}:provider`]]);

    const { SessionManager } = await import("@/lib/session-manager");
    const result = await SessionManager.terminateSession(sessionId);

    expect(result.markerOk).toBe(false);
    expect(deletePipelineRef.del).toHaveBeenCalledWith(`session:${sessionId}:provider`);
  });

  it("当清理过程抛错时，应尽量保留 markerOk=true（如果终止标记已写入）", async () => {
    const sessionId = "sess_cleanup_fail";
    const terminatedKey = `session:${sessionId}:terminated`;
    redisClientRef.scan.mockRejectedValueOnce(new Error("scan failed"));

    const { SessionManager } = await import("@/lib/session-manager");
    const result = await SessionManager.terminateSession(sessionId);

    expect(redisClientRef.set).toHaveBeenCalledWith(terminatedKey, expect.any(String), "EX", 86400);
    expect(result.markerOk).toBe(true);
  });
});
