import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    getCachedSystemSettings: vi.fn(async () => ({
      enableThinkingEffortConflictRectifier: true,
      enableHighConcurrencyMode: false,
    })),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(async () => {}),
    getCircuitState: vi.fn(() => "closed"),
    getProviderHealthInfo: vi.fn(async () => ({
      health: { failureCount: 0 },
      config: { failureThreshold: 3 },
    })),
    updateMessageRequestDetails: vi.fn(async () => {}),
    storeSessionSpecialSettings: vi.fn(async () => {}),
    updateSessionBindingSmart: vi.fn(async () => ({
      updated: true,
      reason: "first_success",
      details: "mocked",
    })),
    updateSessionProvider: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    isHttp2Enabled: vi.fn(async () => false),
    getCachedSystemSettings: mocks.getCachedSystemSettings,
  };
});

vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: mocks.getCircuitState,
  getProviderHealthInfo: mocks.getProviderHealthInfo,
  recordFailure: mocks.recordFailure,
  recordSuccess: mocks.recordSuccess,
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestDetails: mocks.updateMessageRequestDetails,
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    storeSessionSpecialSettings: mocks.storeSessionSpecialSettings,
    updateSessionBindingSmart: mocks.updateSessionBindingSmart,
    updateSessionProvider: mocks.updateSessionProvider,
  },
}));

import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

const DEEPSEEK_CONFLICT_ERROR =
  'Provider returned 400: Bad Request | Upstream: {"error":{"message":"thinking options type cannot be disabled when reasoning_effort is set","type":"invalid_request_error","param":null,"code":"invalid_request_error"}}';

function createSession(): ProxySession {
  const headers = new Headers();
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/messages"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "deepseek-v4-pro",
      log: "",
      message: {
        model: "deepseek-v4-pro",
        thinking: { type: "disabled" },
        output_config: { effort: "max" },
        messages: [{ role: "user", content: [{ type: "text", text: "subagent task" }] }],
      },
    },
    userAgent: null,
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: { id: 123, createdAt: new Date(), user: { id: 1 }, key: {}, apiKey: "k" },
    sessionId: null,
    requestSequence: 1,
    originalFormat: "claude",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    highConcurrencyModeEnabled: false,
    isHeaderModified: () => false,
    setHighConcurrencyModeEnabled(enabled: boolean) {
      this.highConcurrencyModeEnabled = enabled;
    },
    shouldPersistSessionDebugArtifacts() {
      return !this.highConcurrencyModeEnabled;
    },
    shouldTrackSessionObservability() {
      return !this.highConcurrencyModeEnabled;
    },
  });

  return session as any;
}

function createAnthropicProvider(): Provider {
  return {
    id: 1,
    name: "deepseek-anthropic",
    providerType: "claude",
    url: "https://api.deepseek.com/anthropic/v1/messages",
    key: "k",
    preserveClientIp: false,
    priority: 0,
  } as unknown as Provider;
}

function okResponse(): Response {
  const body = JSON.stringify({ type: "message", content: [{ type: "text", text: "ok" }] });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", "content-length": String(body.length) },
  });
}

describe("ProxyForwarder - thinking effort conflict rectifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedSystemSettings.mockResolvedValue({
      enableThinkingEffortConflictRectifier: true,
      enableHighConcurrencyMode: false,
    });
  });

  test("命中 DeepSeek thinking/reasoning_effort 冲突 400 时应剥离 effort 字段并对同供应商重试一次", async () => {
    const session = createSession();
    session.setProvider(createAnthropicProvider());

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    doForward.mockImplementationOnce(async () => {
      throw new ProxyError(DEEPSEEK_CONFLICT_ERROR, 400, {
        body: "",
        providerId: 1,
        providerName: "deepseek-anthropic",
      });
    });

    doForward.mockImplementationOnce(async (s: ProxySession) => {
      const msg = s.request.message as any;
      expect("output_config" in msg).toBe(false);
      expect("reasoning_effort" in msg).toBe(false);
      expect(msg.thinking).toEqual({ type: "disabled" });
      return okResponse();
    });

    const response = await ProxyForwarder.send(session);

    expect(response.status).toBe(200);
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(session.getProviderChain()?.length).toBeGreaterThanOrEqual(2);

    const special = JSON.stringify(session.getSpecialSettings());
    expect(special).toContain("thinking_effort_conflict_rectifier");
    expect(special).not.toContain("thinking_signature_rectifier");
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledTimes(1);
  });

  test("开关关闭时不整流也不重试", async () => {
    mocks.getCachedSystemSettings.mockResolvedValue({
      enableThinkingEffortConflictRectifier: false,
      enableHighConcurrencyMode: false,
    });

    const session = createSession();
    session.setProvider(createAnthropicProvider());

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");
    doForward.mockImplementation(async () => {
      throw new ProxyError(DEEPSEEK_CONFLICT_ERROR, 400, {
        body: "",
        providerId: 1,
        providerName: "deepseek-anthropic",
      });
    });

    await expect(ProxyForwarder.send(session)).rejects.toThrow();

    // 开关关闭：请求体不被整流（常规重试策略仍可能多次尝试，但都带原始字段）
    const message = session.request.message as Record<string, unknown>;
    expect(message.output_config).toEqual({ effort: "max" });
    expect(JSON.stringify(session.getSpecialSettings() ?? [])).not.toContain(
      "thinking_effort_conflict_rectifier"
    );
    expect(doForward.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test("请求体不含冲突字段时记录 not_applicable 且不重试", async () => {
    const session = createSession();
    const message = session.request.message as Record<string, unknown>;
    delete message.output_config;
    (message.thinking as Record<string, unknown>).type = "enabled";
    session.setProvider(createAnthropicProvider());

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");
    doForward.mockImplementation(async () => {
      throw new ProxyError(DEEPSEEK_CONFLICT_ERROR, 400, {
        body: "",
        providerId: 1,
        providerName: "deepseek-anthropic",
      });
    });

    await expect(ProxyForwarder.send(session)).rejects.toThrow();
    expect(doForward).toHaveBeenCalledTimes(1);

    const special = JSON.stringify(session.getSpecialSettings());
    expect(special).toContain("thinking_effort_conflict_rectifier");
    expect(special).toContain('"hit":false');
  });

  test("同一供应商最多整流重试一次（第二次命中不再重试）", async () => {
    const session = createSession();
    session.setProvider(createAnthropicProvider());

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");
    doForward.mockImplementation(async (s: ProxySession) => {
      // 即使整流移除了 effort 字段，上游仍持续返回同样错误
      void s;
      throw new ProxyError(DEEPSEEK_CONFLICT_ERROR, 400, {
        body: "",
        providerId: 1,
        providerName: "deepseek-anthropic",
      });
    });

    await expect(ProxyForwarder.send(session)).rejects.toThrow();
    expect(doForward).toHaveBeenCalledTimes(2);
  });
});
