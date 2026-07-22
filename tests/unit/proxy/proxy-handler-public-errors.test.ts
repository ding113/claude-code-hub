import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { FakeStreamingWhitelistEntry } from "@/types/system-config";

type ProxySettingsFixture = {
  readonly enableHighConcurrencyMode: boolean;
  readonly allowNonConversationEndpointProviderFallback: boolean;
  readonly fakeStreamingWhitelist: FakeStreamingWhitelistEntry[];
  readonly passThroughUpstreamErrorMessage: boolean;
  readonly verboseProviderError: boolean;
};

const boundary = vi.hoisted(() => ({
  decrementConcurrentCount: vi.fn<(sessionId: string) => Promise<void>>(),
  emitProxyLangfuseTrace: vi.fn(),
  getErrorOverride: vi.fn<(error: Error) => Promise<null>>(),
  incrementConcurrentCount: vi.fn<(sessionId: string) => Promise<void>>(),
  loadSettings: vi.fn<() => Promise<ProxySettingsFixture>>(),
  runGuards: vi.fn<(session: ProxySession) => Promise<Response | null>>(),
  send: vi.fn<(session: ProxySession) => Promise<Response>>(),
  updateMessageRequestDetailsDurably: vi.fn(),
}));

vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  getCachedSystemSettings: boundary.loadSettings,
}));

vi.mock("@/lib/config/system-settings-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/system-settings-cache")>()),
  getCachedSystemSettings: boundary.loadSettings,
}));

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

vi.mock("@/lib/langfuse/emit-proxy-trace", () => ({
  emitProxyLangfuseTrace: boundary.emitProxyLangfuseTrace,
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestDetailsDurably: boundary.updateMessageRequestDetailsDurably,
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    decrementConcurrentCount: boundary.decrementConcurrentCount,
    incrementConcurrentCount: boundary.incrementConcurrentCount,
    refreshSession: vi.fn(),
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({ endRequest: vi.fn(), startRequest: vi.fn() }),
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
};

describe("handleProxyRequest public error behavior", () => {
  beforeEach(() => {
    boundary.runGuards.mockReset();
    boundary.send.mockReset();
    boundary.incrementConcurrentCount.mockReset();
    boundary.decrementConcurrentCount.mockReset();
    boundary.loadSettings.mockReset();
    boundary.getErrorOverride.mockReset();
    boundary.loadSettings.mockResolvedValue(settings);
    boundary.getErrorOverride.mockResolvedValue(null);
    boundary.incrementConcurrentCount.mockResolvedValue(undefined);
    boundary.decrementConcurrentCount.mockResolvedValue(undefined);
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
    const request = new (class extends Request {
      override clone(): Request {
        throw new Error("request clone failed");
      }
    })("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-test", messages: [] }),
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
});
