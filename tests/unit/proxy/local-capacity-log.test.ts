import { Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  values: vi.fn(),
  validateApiKeyAndGetUser: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/drizzle/db", () => ({
  db: { insert: () => ({ values: boundary.values }) },
}));

vi.mock("@/repository/key", () => ({
  validateApiKeyAndGetUser: boundary.validateApiKeyAndGetUser,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: boundary.error,
    info: vi.fn(),
    trace: vi.fn(),
    warn: boundary.warn,
  },
}));

import {
  LOCAL_CAPACITY_BLOCKED_BY,
  recordLocalCapacityRejection,
  recordPreAuthLocalCapacityRejection,
  resetLocalCapacityLogThrottleForTests,
} from "@/app/v1/_lib/proxy/local-capacity-log";

const MESSAGE = "Local request capacity exhausted; retry later.";

function context(headers: Record<string, string> = {}): Context {
  return new Context(
    new Request("http://localhost/v1/responses", {
      method: "POST",
      headers,
    })
  );
}

describe("本地容量 429 落库", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    resetLocalCapacityLogThrottleForTests();
    boundary.values.mockReset();
    boundary.validateApiKeyAndGetUser.mockReset();
    boundary.warn.mockReset();
    boundary.error.mockReset();
    boundary.values.mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());

  it("认证后的拒绝按被拦截请求约定写入，不计费", async () => {
    const logged = await recordLocalCapacityRejection({
      userId: 9,
      apiKey: "sk-a",
      stage: "pipeline",
      errorMessage: MESSAGE,
      durationMs: 20_001,
      model: "gpt-test",
      sessionId: "s1",
      endpoint: "/v1/responses",
      userAgent: "codex",
      clientIp: "10.0.0.1",
    });
    expect(logged).toBe(true);
    expect(boundary.values).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        providerId: 0,
        userId: 9,
        key: "sk-a",
        model: "gpt-test",
        sessionId: "s1",
        endpoint: "/v1/responses",
        userAgent: "codex",
        clientIp: "10.0.0.1",
        statusCode: 429,
        durationMs: 20_001,
        costUsd: "0",
        blockedBy: LOCAL_CAPACITY_BLOCKED_BY,
        errorMessage: MESSAGE,
      })
    );
    const reason = JSON.parse(boundary.values.mock.calls[0][0].blockedReason);
    expect(reason).toMatchObject({ stage: "pipeline", suppressedSinceLastRow: 0 });
    expect(reason).toHaveProperty("usedBytes");
    expect(reason).toHaveProperty("limitBytes");
  });

  it("同一 key 10 秒内只落一行，被抑制的次数计入下一行；不同 key 互不影响", async () => {
    const rejection = {
      userId: 9,
      apiKey: "sk-a",
      stage: "pipeline",
      errorMessage: MESSAGE,
    } as const;
    expect(await recordLocalCapacityRejection(rejection)).toBe(true);
    expect(await recordLocalCapacityRejection(rejection)).toBe(false);
    expect(await recordLocalCapacityRejection(rejection)).toBe(false);
    expect(await recordLocalCapacityRejection({ ...rejection, apiKey: "sk-b" })).toBe(true);
    expect(boundary.values).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(10_000);
    expect(await recordLocalCapacityRejection(rejection)).toBe(true);
    expect(JSON.parse(boundary.values.mock.calls[2][0].blockedReason).suppressedSinceLastRow).toBe(
      2
    );
  });

  it("写库失败只记录日志，不向 429 路径抛出", async () => {
    boundary.values.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      recordLocalCapacityRejection({
        userId: 9,
        apiKey: "sk-a",
        stage: "pipeline",
        errorMessage: MESSAGE,
      })
    ).resolves.toBe(false);
    expect(boundary.error).toHaveBeenCalledOnce();
  });

  it("认证前的拒绝用请求头里的 key 尽力归属", async () => {
    boundary.validateApiKeyAndGetUser.mockResolvedValue({ user: { id: 42 }, key: { id: 7 } });
    const startedAt = Date.now() - 20_000;
    const logged = await recordPreAuthLocalCapacityRejection(
      context({ authorization: "Bearer sk-pre", "user-agent": "OpenAI/JS 6.26.0" }),
      MESSAGE,
      startedAt
    );
    expect(logged).toBe(true);
    expect(boundary.validateApiKeyAndGetUser).toHaveBeenCalledExactlyOnceWith("sk-pre");
    expect(boundary.values).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        providerId: 0,
        userId: 42,
        key: "sk-pre",
        endpoint: "/v1/responses",
        userAgent: "OpenAI/JS 6.26.0",
        statusCode: 429,
        durationMs: 20_000,
        blockedBy: LOCAL_CAPACITY_BLOCKED_BY,
      })
    );
    expect(JSON.parse(boundary.values.mock.calls[0][0].blockedReason).stage).toBe("body_intake");
    expect(boundary.warn).toHaveBeenCalledExactlyOnceWith(
      "[LocalCapacity] Request rejected during body intake",
      expect.objectContaining({ pathname: "/v1/responses", governor: expect.any(Object) })
    );
  });

  it("认证前：无凭据、未知 key 或被节流时只留结构化日志，不查库不写库", async () => {
    expect(await recordPreAuthLocalCapacityRejection(context(), MESSAGE, Date.now())).toBe(false);
    expect(boundary.validateApiKeyAndGetUser).not.toHaveBeenCalled();

    boundary.validateApiKeyAndGetUser.mockResolvedValueOnce(null);
    expect(
      await recordPreAuthLocalCapacityRejection(
        context({ "x-api-key": "sk-unknown" }),
        MESSAGE,
        Date.now()
      )
    ).toBe(false);

    boundary.validateApiKeyAndGetUser.mockResolvedValue({ user: { id: 42 }, key: { id: 7 } });
    const known = () => context({ "x-api-key": "sk-known" });
    expect(await recordPreAuthLocalCapacityRejection(known(), MESSAGE, Date.now())).toBe(true);
    expect(await recordPreAuthLocalCapacityRejection(known(), MESSAGE, Date.now())).toBe(false);
    // 被节流的重试不再触发 key 查询。
    expect(boundary.validateApiKeyAndGetUser).toHaveBeenCalledTimes(2);
    expect(boundary.values).toHaveBeenCalledOnce();
    expect(boundary.warn).toHaveBeenCalledTimes(4);
  });

  it("认证前归属过程抛错时不影响 429", async () => {
    boundary.validateApiKeyAndGetUser.mockRejectedValue(new Error("redis down"));
    await expect(
      recordPreAuthLocalCapacityRejection(context({ "x-api-key": "sk-x" }), MESSAGE, Date.now())
    ).resolves.toBe(false);
    expect(boundary.error).toHaveBeenCalledOnce();
    expect(boundary.values).not.toHaveBeenCalled();
  });
});
