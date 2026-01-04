import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

const getCachedSystemSettingsMock = vi.fn();

const dbInsertValuesMock = vi.fn();
const dbInsertMock = vi.fn(() => ({ values: dbInsertValuesMock }));

const storeSessionResponseMock = vi.fn();
const storeSessionResponseHeadersMock = vi.fn();
const storeSessionUpstreamRequestMetaMock = vi.fn();
const storeSessionUpstreamResponseMetaMock = vi.fn();

const loggerErrorMock = vi.fn();
const loggerDebugMock = vi.fn();

vi.mock("@/lib/config", () => ({
  getCachedSystemSettings: () => getCachedSystemSettingsMock(),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: dbInsertMock,
  },
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    storeSessionResponse: storeSessionResponseMock,
    storeSessionResponseHeaders: storeSessionResponseHeadersMock,
    storeSessionUpstreamRequestMeta: storeSessionUpstreamRequestMetaMock,
    storeSessionUpstreamResponseMeta: storeSessionUpstreamResponseMetaMock,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: loggerErrorMock,
    debug: loggerDebugMock,
    trace: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

async function loadGuard() {
  const mod = await import("@/app/v1/_lib/proxy/warmup-guard");
  return mod.ProxyWarmupGuard;
}

function createMockSession(overrides: Partial<ProxySession> = {}): ProxySession {
  const base: ProxySession = {
    isWarmupRequest: () => true,
    sessionId: "session_test",
    getRequestSequence: () => 2,
    method: "POST",
    startTime: Date.now() - 10,
    userAgent: "claude_cli/1.0",
    request: { model: "claude-sonnet-4-5-20250929" } as any,
    authState: {
      success: true,
      user: { id: 123 },
      key: { id: 456 },
      apiKey: "user-key-test",
    } as any,
    getOriginalModel: () => "claude-original",
    getEndpoint: () => "/v1/messages",
    getMessagesLength: () => 1,
  } as unknown as ProxySession;

  return { ...base, ...overrides } as ProxySession;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCachedSystemSettingsMock.mockResolvedValue({ interceptAnthropicWarmupRequests: true });
  dbInsertValuesMock.mockResolvedValue(undefined);
  storeSessionResponseMock.mockResolvedValue(undefined);
  storeSessionResponseHeadersMock.mockResolvedValue(undefined);
  storeSessionUpstreamRequestMetaMock.mockResolvedValue(undefined);
  storeSessionUpstreamResponseMetaMock.mockResolvedValue(undefined);
});

describe("ProxyWarmupGuard.ensure", () => {
  test("非 warmup 请求应直接放行（不读取系统设置）", async () => {
    const ProxyWarmupGuard = await loadGuard();
    const session = createMockSession({ isWarmupRequest: () => false });

    const result = await ProxyWarmupGuard.ensure(session);
    expect(result).toBeNull();
    expect(getCachedSystemSettingsMock).not.toHaveBeenCalled();
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  test("开关关闭时不应拦截", async () => {
    const ProxyWarmupGuard = await loadGuard();
    getCachedSystemSettingsMock.mockResolvedValue({ interceptAnthropicWarmupRequests: false });

    const result = await ProxyWarmupGuard.ensure(createMockSession());
    expect(result).toBeNull();
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  test("认证态不完整时不应拦截", async () => {
    const ProxyWarmupGuard = await loadGuard();

    const result = await ProxyWarmupGuard.ensure(
      createMockSession({ authState: { success: true, user: null } as any })
    );
    expect(result).toBeNull();
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  test("开关开启且命中 warmup 时应返回抢答响应，并写入 Session/日志", async () => {
    const ProxyWarmupGuard = await loadGuard();
    const session = createMockSession();

    const result = await ProxyWarmupGuard.ensure(session);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(200);
    expect(result?.headers.get("content-type")).toContain("application/json");
    expect(result?.headers.get("x-cch-intercepted")).toBe("warmup");
    expect(result?.headers.get("x-cch-intercepted-by")).toBe("claude-code-hub");

    const body = await result!.json();
    expect(body).toEqual(
      expect.objectContaining({
        type: "message",
        role: "assistant",
        content: [expect.objectContaining({ type: "text", text: "I'm ready to help you." })],
      })
    );

    expect(storeSessionResponseMock).toHaveBeenCalledTimes(1);
    expect(storeSessionResponseMock).toHaveBeenCalledWith("session_test", expect.any(String), 2);
    expect(storeSessionResponseHeadersMock).toHaveBeenCalledWith(
      "session_test",
      expect.any(Headers),
      2
    );
    expect(storeSessionUpstreamRequestMetaMock).toHaveBeenCalledWith(
      "session_test",
      { url: "/__cch__/warmup", method: "POST" },
      2
    );
    expect(storeSessionUpstreamResponseMetaMock).toHaveBeenCalledWith(
      "session_test",
      { url: "/__cch__/warmup", statusCode: 200 },
      2
    );

    expect(dbInsertMock).toHaveBeenCalledTimes(1);
    expect(dbInsertValuesMock).toHaveBeenCalledTimes(1);
    expect(dbInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 0,
        key: "user-key-test",
        sessionId: "session_test",
        requestSequence: 2,
        endpoint: "/v1/messages",
        messagesCount: 1,
        statusCode: 200,
        costUsd: null,
        blockedBy: "warmup",
      })
    );

    expect(loggerDebugMock).toHaveBeenCalledTimes(1);
  });

  test("日志写入失败时也应正常返回抢答响应", async () => {
    const ProxyWarmupGuard = await loadGuard();
    dbInsertValuesMock.mockRejectedValueOnce(new Error("db error"));

    const result = await ProxyWarmupGuard.ensure(createMockSession());
    expect(result).not.toBeNull();
    expect(result?.status).toBe(200);
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
  });
});
