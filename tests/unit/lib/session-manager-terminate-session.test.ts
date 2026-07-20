import { beforeEach, describe, expect, it, vi } from "vitest";

let redisClientRef: any;
let pipelineRef: any;
const bindingMocks = vi.hoisted(() => ({
  clearSessionBinding: vi.fn(),
  compareAndSetSessionBinding: vi.fn(),
  isSessionProviderCoolingDown: vi.fn(),
  mutateLegacySessionBindingSafely: vi.fn(),
  readOrReconcileSessionBinding: vi.fn(),
  refreshSessionBinding: vi.fn(),
  terminateSessionBinding: vi.fn(),
}));

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

vi.mock("@/lib/redis/session-binding", () => ({
  ...bindingMocks,
  getVersionedBindingCapabilityState: () => "unavailable",
}));

describe("SessionManager.terminateSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    pipelineRef = {
      del: vi.fn(() => pipelineRef),
      zrem: vi.fn(() => pipelineRef),
      hdel: vi.fn(() => pipelineRef),
      exec: vi.fn(async () => [[null, 1]]),
    };

    redisClientRef = {
      status: "ready",
      get: vi.fn(async () => null),
      hget: vi.fn(async () => null),
      del: vi.fn(async () => 1),
      eval: vi.fn(async () => 1),
      pipeline: vi.fn(() => pipelineRef),
    };
    bindingMocks.readOrReconcileSessionBinding.mockResolvedValue({
      status: "unavailable",
      reason: "capability_unavailable",
      capabilityState: "unavailable",
      legacyFallbackAllowed: true,
    });
    bindingMocks.mutateLegacySessionBindingSafely.mockResolvedValue({
      status: "ok",
      changed: true,
      providerId: null,
    });
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

  it("迟到 cleanup 仅删除仍绑定到预期 provider 的 session", async () => {
    const { SessionManager } = await import("@/lib/session-manager");

    await expect(SessionManager.clearSessionProvider("sess_compare", 42, 7)).resolves.toBe(true);

    expect(bindingMocks.mutateLegacySessionBindingSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_compare",
        keyId: 7,
        mutation: { type: "clear", expectedProviderId: 42 },
      })
    );
  });

  it("迟到 cleanup 不删除已切换到新 provider 的 session", async () => {
    bindingMocks.mutateLegacySessionBindingSafely.mockResolvedValueOnce({
      status: "conflict",
      reason: "provider_mismatch",
      legacyFallbackAllowed: false,
    });
    const { SessionManager } = await import("@/lib/session-manager");

    await expect(SessionManager.clearSessionProvider("sess_compare", 42, 7)).resolves.toBe(false);
    expect(redisClientRef.del).not.toHaveBeenCalled();
  });

  it("versioned termination leaves an owned tombstone instead of deleting mirrors", async () => {
    const sessionId = "sess_versioned";
    redisClientRef.get.mockImplementation(async (key: string) => {
      if (key === `session:${sessionId}:provider`) return "42";
      if (key === `session:${sessionId}:key`) return "7";
      return null;
    });
    bindingMocks.readOrReconcileSessionBinding.mockResolvedValue({
      status: "ok",
      source: "existing",
      snapshot: {
        sessionId,
        keyId: 7,
        providerId: 42,
        generation: "generation-a",
      },
      legacyFallbackAllowed: false,
    });
    bindingMocks.terminateSessionBinding.mockResolvedValue({
      status: "ok",
      source: "terminated",
      snapshot: {
        sessionId,
        keyId: 7,
        providerId: null,
        generation: "generation-b",
      },
      legacyFallbackAllowed: false,
    });
    const { SessionManager } = await import("@/lib/session-manager");

    await expect(SessionManager.terminateSession(sessionId)).resolves.toBe(true);

    expect(bindingMocks.terminateSessionBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        keyId: 7,
      })
    );
    expect(pipelineRef.del).not.toHaveBeenCalledWith(`session:${sessionId}:provider`);
    expect(pipelineRef.del).not.toHaveBeenCalledWith(`session:${sessionId}:key`);
  });
});
