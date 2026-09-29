import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageContext, ProxySession } from "@/app/v1/_lib/proxy/session";
import type { FakeStreamingWhitelistEntry } from "@/types/system-config";
import { LocalCapacityError, MemoryGovernor } from "../../../server-lib/memory-governor";

type ProxySettingsFixture = {
  readonly enableHighConcurrencyMode: boolean;
  readonly allowNonConversationEndpointProviderFallback: boolean;
  readonly fakeStreamingWhitelist: FakeStreamingWhitelistEntry[];
  readonly passThroughUpstreamErrorMessage: boolean;
  readonly verboseProviderError: boolean;
  readonly enableMemoryAdmission: boolean;
};

const boundary = vi.hoisted(() => ({
  decrementConcurrentCount: vi.fn<(sessionId: string) => Promise<void>>(),
  decrementObservedConcurrentCount: vi.fn<(identity: string) => Promise<void>>(),
  emitProxyLangfuseTrace: vi.fn(),
  endRequest: vi.fn(),
  getErrorOverride: vi.fn<(error: Error) => Promise<null>>(),
  incrementConcurrentCount: vi.fn<(sessionId: string) => Promise<void>>(),
  incrementObservedConcurrentCount: vi.fn<(identity: string) => Promise<void>>(),
  loadSettings: vi.fn<() => Promise<ProxySettingsFixture>>(),
  // 进程缓存中的当前设置对象；只有与之相同的读取结果才会同步到内存准入开关。
  processCache: { current: null as ProxySettingsFixture | null },
  recordLocalCapacityRejection: vi.fn(),
  recordPreAuthLocalCapacityRejection: vi.fn(),
  runGuards: vi.fn<(session: ProxySession) => Promise<Response | null>>(),
  send: vi.fn<(session: ProxySession) => Promise<Response>>(),
  trackObservedSession: vi.fn<(identity: string) => Promise<void>>(),
  updateMessageRequestDetailsDurably: vi.fn(),
}));

vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  getCachedSystemSettings: boundary.loadSettings,
  getCachedSystemSettingsOnlyCache: () => boundary.processCache.current,
}));

vi.mock("@/lib/config/system-settings-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/system-settings-cache")>()),
  getCachedSystemSettings: boundary.loadSettings,
  getCachedSystemSettingsOnlyCache: () => boundary.processCache.current,
}));

function cacheSettings(value: ProxySettingsFixture): void {
  boundary.processCache.current = value;
  boundary.loadSettings.mockResolvedValue(value);
}

vi.mock("@/app/v1/_lib/proxy/guard-pipeline", () => ({
  GuardPipelineBuilder: {
    fromSession: () => ({ run: boundary.runGuards }),
  },
}));

vi.mock("@/app/v1/_lib/proxy/forwarder", () => ({
  ProxyForwarder: { send: boundary.send },
}));

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>()),
  getErrorOverrideAsync: boundary.getErrorOverride,
}));

vi.mock("@/app/v1/_lib/proxy/local-capacity-log", () => ({
  recordLocalCapacityRejection: boundary.recordLocalCapacityRejection,
  recordPreAuthLocalCapacityRejection: boundary.recordPreAuthLocalCapacityRejection,
}));

vi.mock("@/lib/langfuse/emit-proxy-trace", () => ({
  emitProxyLangfuseTrace: boundary.emitProxyLangfuseTrace,
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestDetailsDurably: boundary.updateMessageRequestDetailsDurably,
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    decrementConcurrentCount: boundary.decrementConcurrentCount,
    decrementObservedConcurrentCount: boundary.decrementObservedConcurrentCount,
    incrementConcurrentCount: boundary.incrementConcurrentCount,
    incrementObservedConcurrentCount: boundary.incrementObservedConcurrentCount,
    refreshSession: vi.fn(),
    trackObservedSession: boundary.trackObservedSession,
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({ endRequest: boundary.endRequest, startRequest: vi.fn() }),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import { handleProxyRequest } from "@/app/v1/_lib/proxy-handler";

const settings: ProxySettingsFixture = {
  enableHighConcurrencyMode: false,
  allowNonConversationEndpointProviderFallback: true,
  fakeStreamingWhitelist: [],
  passThroughUpstreamErrorMessage: false,
  verboseProviderError: false,
  enableMemoryAdmission: false,
};

describe("handleProxyRequest public error behavior", () => {
  beforeEach(() => {
    boundary.runGuards.mockReset();
    boundary.send.mockReset();
    boundary.incrementConcurrentCount.mockReset();
    boundary.decrementConcurrentCount.mockReset();
    boundary.incrementObservedConcurrentCount.mockReset();
    boundary.decrementObservedConcurrentCount.mockReset();
    boundary.trackObservedSession.mockReset();
    boundary.loadSettings.mockReset();
    boundary.getErrorOverride.mockReset();
    boundary.endRequest.mockReset();
    boundary.updateMessageRequestDetailsDurably.mockReset();
    boundary.recordLocalCapacityRejection.mockReset();
    boundary.recordPreAuthLocalCapacityRejection.mockReset();
    boundary.recordLocalCapacityRejection.mockResolvedValue(true);
    boundary.recordPreAuthLocalCapacityRejection.mockResolvedValue(true);
    cacheSettings(settings);
    boundary.getErrorOverride.mockResolvedValue(null);
    boundary.incrementConcurrentCount.mockResolvedValue(undefined);
    boundary.decrementConcurrentCount.mockResolvedValue(undefined);
    boundary.incrementObservedConcurrentCount.mockResolvedValue(undefined);
    boundary.decrementObservedConcurrentCount.mockResolvedValue(undefined);
    boundary.trackObservedSession.mockResolvedValue(undefined);
  });

  it("translates a post-session forwarding error through the real error handler", async () => {
    boundary.runGuards.mockImplementation(async (session) => {
      session.setSessionId("session-forward-error");
      return null;
    });
    boundary.send.mockRejectedValue(new ProxyError("upstream unavailable", 503));
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-test", messages: [] }),
    });

    const response = await handleProxyRequest(new Context(request));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        message: "上游服务暂时不可用，请稍后重试 (cch_session_id: session-forward-error)",
        type: "service_unavailable_error",
        code: "service_unavailable_error",
      },
    });
    expect(boundary.incrementConcurrentCount).toHaveBeenCalledWith("session-forward-error");
    expect(boundary.decrementConcurrentCount).toHaveBeenCalledWith("session-forward-error");
  });

  it("returns a public ProxyError response when request decoding fails before session creation", async () => {
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: {
        "content-encoding": "gzip",
        "content-type": "application/json",
      },
      body: "not-a-gzip-stream",
    });

    const response = await handleProxyRequest(new Context(request));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("Failed to decode 'gzip' request body");
    expect(boundary.runGuards).not.toHaveBeenCalled();
    expect(boundary.decrementConcurrentCount).not.toHaveBeenCalled();
  });

  it("hides an unknown failure that occurs before session creation", async () => {
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-test", messages: [] }),
    });
    Object.defineProperty(request, "body", {
      get() {
        throw new Error("request body read failed");
      },
    });

    const response = await handleProxyRequest(new Context(request));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        message: "代理请求发生未知错误",
        type: "internal_server_error",
        code: "internal_server_error",
      },
    });
    expect(boundary.runGuards).not.toHaveBeenCalled();
    expect(boundary.decrementConcurrentCount).not.toHaveBeenCalled();
  });

  it("本地过载保留 429 与 Retry-After，不能变成供应商错误", async () => {
    boundary.send.mockRejectedValue(new LocalCapacityError());
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "claude-test", messages: [] }),
    });
    const response = await handleProxyRequest(new Context(request));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    expect((await response.json()).error.code).toBe("local_capacity_exceeded");
  });

  it.each([false, true])("本地过载持久化失败=%s 时都结束追踪及实时观测", async (fails) => {
    const close = vi.fn().mockResolvedValue(undefined);
    boundary.runGuards.mockImplementation(async (session) => {
      session.setMessageContext({ id: 17, user: { id: 9 } } as MessageContext);
      vi.spyOn(session, "closeLiveObservability").mockImplementation(close);
      return null;
    });
    if (fails)
      boundary.updateMessageRequestDetailsDurably.mockRejectedValueOnce(
        new Error("database unavailable")
      );
    boundary.send.mockRejectedValue(new LocalCapacityError());
    const response = await handleProxyRequest(
      new Context(
        new Request("http://localhost/v1/messages", {
          method: "POST",
          body: JSON.stringify({ model: "claude-test", messages: [] }),
        })
      )
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    expect((await response.json()).error.code).toBe("local_capacity_exceeded");
    expect(boundary.updateMessageRequestDetailsDurably).toHaveBeenCalledOnce();
    expect(boundary.recordLocalCapacityRejection).not.toHaveBeenCalled();
    expect(boundary.endRequest).toHaveBeenCalledExactlyOnceWith(9, 17);
    expect(close).toHaveBeenCalledOnce();
  });

  it("认证后、message_request 行创建前的本地过载按被拦截请求补记一行", async () => {
    boundary.runGuards.mockImplementation(async (session) => {
      session.setAuthState({
        success: true,
        user: { id: 9 },
        key: { id: 3 },
        apiKey: "sk-test",
      } as Parameters<ProxySession["setAuthState"]>[0]);
      throw new LocalCapacityError();
    });
    const response = await handleProxyRequest(
      new Context(
        new Request("http://localhost/v1/messages", {
          method: "POST",
          headers: { "user-agent": "codex-test" },
          body: JSON.stringify({ model: "claude-test", messages: [] }),
        })
      )
    );
    expect(response.status).toBe(429);
    expect(boundary.updateMessageRequestDetailsDurably).not.toHaveBeenCalled();
    expect(boundary.recordLocalCapacityRejection).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: 9,
        apiKey: "sk-test",
        stage: "pipeline",
        model: "claude-test",
        userAgent: "codex-test",
        errorMessage: "Local request capacity exhausted; retry later.",
      })
    );
    expect(boundary.recordPreAuthLocalCapacityRejection).not.toHaveBeenCalled();
  });

  it("未认证的本地过载不写库", async () => {
    boundary.runGuards.mockRejectedValue(new LocalCapacityError());
    const response = await handleProxyRequest(
      new Context(
        new Request("http://localhost/v1/messages", {
          method: "POST",
          body: JSON.stringify({ model: "claude-test", messages: [] }),
        })
      )
    );
    expect(response.status).toBe(429);
    expect(boundary.recordLocalCapacityRejection).not.toHaveBeenCalled();
  });

  it("请求体读取前最多排队 20 秒，拒绝时不调用上游", async () => {
    vi.useFakeTimers();
    const key = Symbol.for("cch.memoryGovernor");
    const state = globalThis as unknown as Record<symbol, unknown>;
    const previous = state[key];
    state[key] = new MemoryGovernor({ limit: 0, remote: false, monitor: false });
    cacheSettings({ ...settings, enableMemoryAdmission: true });
    try {
      const request = new Request("http://localhost/v1/messages", {
        method: "POST",
        body: JSON.stringify({ model: "claude-test", messages: [] }),
      });
      let completed = false;
      const pending = handleProxyRequest(new Context(request)).then((response) => {
        completed = true;
        return response;
      });
      await vi.advanceTimersByTimeAsync(19999);
      expect(completed).toBe(false);
      expect(request.bodyUsed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("1");
      expect(boundary.runGuards).not.toHaveBeenCalled();
      expect(boundary.send).not.toHaveBeenCalled();
      // 认证前没有 session：交给请求头尽力归属，且不阻塞 429。
      expect(boundary.recordPreAuthLocalCapacityRejection).toHaveBeenCalledExactlyOnceWith(
        expect.any(Context),
        "Local request capacity exhausted; retry later.",
        expect.any(Number)
      );
      expect(boundary.recordLocalCapacityRejection).not.toHaveBeenCalled();
    } finally {
      state[key] = previous;
      vi.useRealTimers();
    }
  });

  it("内存准入关闭时请求体读取不排队，零额度也照常进入守卫链", async () => {
    const key = Symbol.for("cch.memoryGovernor");
    const state = globalThis as unknown as Record<symbol, unknown>;
    const previous = state[key];
    const governor = new MemoryGovernor({ limit: 0, remote: false, monitor: false, enabled: true });
    state[key] = governor;
    boundary.runGuards.mockResolvedValue(new Response("guarded", { status: 403 }));
    try {
      const response = await handleProxyRequest(
        new Context(
          new Request("http://localhost/v1/messages", {
            method: "POST",
            body: JSON.stringify({ model: "claude-test", messages: [], input: "x".repeat(4096) }),
          })
        )
      );
      expect(governor.enabled).toBe(false);
      expect(response.status).toBe(403);
      expect(boundary.runGuards).toHaveBeenCalledTimes(1);
      const session = boundary.runGuards.mock.calls[0]?.[0];
      expect(session?.request.model).toBe("claude-test");
      expect(boundary.recordPreAuthLocalCapacityRejection).not.toHaveBeenCalled();
    } finally {
      state[key] = previous;
    }
  });

  it("读取系统设置失败时保持进程当前的内存准入状态", async () => {
    const key = Symbol.for("cch.memoryGovernor");
    const state = globalThis as unknown as Record<symbol, unknown>;
    const previous = state[key];
    const governor = new MemoryGovernor({
      limit: 64 * 1024 ** 2,
      remote: false,
      monitor: false,
      enabled: true,
    });
    state[key] = governor;
    boundary.loadSettings.mockRejectedValue(new Error("settings unavailable"));
    boundary.runGuards.mockResolvedValue(new Response("guarded", { status: 403 }));
    try {
      const response = await handleProxyRequest(
        new Context(
          new Request("http://localhost/v1/messages", {
            method: "POST",
            body: JSON.stringify({ model: "claude-test", messages: [] }),
          })
        )
      );
      expect(response.status).toBe(403);
      expect(governor.enabled).toBe(true);
      const session = boundary.runGuards.mock.calls[0]?.[0];
      // 设置不可用时 raw 跨供应商回退按既有约定关闭。
      expect(session?.isRawCrossProviderFallbackEnabled()).toBe(false);
    } finally {
      state[key] = previous;
    }
  });

  it("缓存失效期间完成的旧查询与默认对象不改变进程的内存准入状态", async () => {
    const key = Symbol.for("cch.memoryGovernor");
    const state = globalThis as unknown as Record<symbol, unknown>;
    const previous = state[key];
    const governor = new MemoryGovernor({
      limit: 64 * 1024 ** 2,
      remote: false,
      monitor: false,
      enabled: true,
    });
    state[key] = governor;
    boundary.runGuards.mockImplementation(async () => new Response("guarded", { status: 403 }));
    const send = () =>
      handleProxyRequest(
        new Context(
          new Request("http://localhost/v1/messages", {
            method: "POST",
            body: JSON.stringify({ model: "claude-test", messages: [] }),
          })
        )
      );
    try {
      // 失效后缓存为空：读取结果未写入缓存，不能用于全进程开关。
      boundary.processCache.current = null;
      boundary.loadSettings.mockResolvedValue({ ...settings, enableMemoryAdmission: false });
      expect((await send()).status).toBe(403);
      expect(governor.enabled).toBe(true);

      // 缓存已被更新的设置替换，旧查询结果与之不是同一对象。
      boundary.processCache.current = { ...settings, enableMemoryAdmission: true };
      expect((await send()).status).toBe(403);
      expect(governor.enabled).toBe(true);

      // 当前缓存对象正常同步。
      cacheSettings({ ...settings, enableMemoryAdmission: false });
      expect((await send()).status).toBe(403);
      expect(governor.enabled).toBe(false);
    } finally {
      state[key] = previous;
    }
  });
});
