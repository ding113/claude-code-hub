import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock "server-only" to avoid import errors in test environment
vi.mock("server-only", () => ({}));

// Use vi.hoisted so the mock fn is available inside vi.mock factory
const { isResponsesWebSocketEnabledMock } = vi.hoisted(() => ({
  isResponsesWebSocketEnabledMock: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  isResponsesWebSocketEnabled: (...args: unknown[]) => isResponsesWebSocketEnabledMock(...args),
}));

import { classifyTransport, toWebSocketUrl } from "@/app/v1/_lib/proxy/transport-classifier";
import type { Provider } from "@/types/provider";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMinimalSession(pathname: string): ProxySession {
  return {
    requestUrl: new URL(`https://hub.example.com${pathname}`),
  } as unknown as ProxySession;
}

function createMinimalProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "test-provider",
    url: "https://api.openai.com",
    key: "sk-test",
    providerVendorId: null,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "codex",
    preserveClientIp: false,
    modelRedirects: null,
    activeTimeStart: null,
    activeTimeEnd: null,
    allowedModels: null,
    allowedClients: [],
    blockedClients: [],
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1800000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 60000,
    streamingIdleTimeoutMs: 30000,
    requestTimeoutNonStreamingMs: 120000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Provider;
}

// ---------------------------------------------------------------------------
// classifyTransport
// ---------------------------------------------------------------------------

describe("classifyTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns http when global toggle is disabled", async () => {
    isResponsesWebSocketEnabledMock.mockResolvedValue(false);

    const session = createMinimalSession("/v1/responses");
    const provider = createMinimalProvider();

    const result = await classifyTransport(session, provider);

    expect(result).toEqual({
      transport: "http",
      reason: "websocket_disabled",
    });
  });

  it("returns http for non-/v1/responses endpoints", async () => {
    isResponsesWebSocketEnabledMock.mockResolvedValue(true);

    const endpoints = [
      "/v1/messages",
      "/v1/chat/completions",
      "/v1/response",
      "/v1/responses/list",
    ];

    for (const ep of endpoints) {
      const session = createMinimalSession(ep);
      const provider = createMinimalProvider();

      const result = await classifyTransport(session, provider);

      expect(result.transport).toBe("http");
      expect(result.reason).toBe("not_responses_endpoint");
    }
  });

  const nonCodexTypes = [
    "claude",
    "claude-auth",
    "gemini",
    "gemini-cli",
    "openai-compatible",
  ] as const;

  it.each(nonCodexTypes)("returns http for non-codex provider type: %s", async (providerType) => {
    isResponsesWebSocketEnabledMock.mockResolvedValue(true);

    const session = createMinimalSession("/v1/responses");
    const provider = createMinimalProvider({ providerType });

    const result = await classifyTransport(session, provider);

    expect(result).toEqual({
      transport: "http",
      reason: "provider_type_not_codex",
    });
  });

  it("returns http when provider URL is not HTTPS", async () => {
    isResponsesWebSocketEnabledMock.mockResolvedValue(true);

    const session = createMinimalSession("/v1/responses");
    const provider = createMinimalProvider({ url: "http://api.openai.com" });

    const result = await classifyTransport(session, provider);

    expect(result).toEqual({
      transport: "http",
      reason: "provider_url_not_https",
    });
  });

  it("returns http when provider URL is empty", async () => {
    isResponsesWebSocketEnabledMock.mockResolvedValue(true);

    const session = createMinimalSession("/v1/responses");
    const provider = createMinimalProvider({ url: "" });

    const result = await classifyTransport(session, provider);

    expect(result).toEqual({
      transport: "http",
      reason: "provider_url_not_https",
    });
  });

  it("returns http when proxy is configured", async () => {
    isResponsesWebSocketEnabledMock.mockResolvedValue(true);

    const session = createMinimalSession("/v1/responses");
    const provider = createMinimalProvider({
      proxyUrl: "http://proxy.internal:8080",
    });

    const result = await classifyTransport(session, provider);

    expect(result).toEqual({
      transport: "http",
      reason: "proxy_configured",
    });
  });

  it("returns websocket when ALL conditions are met", async () => {
    isResponsesWebSocketEnabledMock.mockResolvedValue(true);

    const session = createMinimalSession("/v1/responses");
    const provider = createMinimalProvider({
      providerType: "codex",
      url: "https://api.openai.com",
      proxyUrl: null,
    });

    const result = await classifyTransport(session, provider);

    expect(result).toEqual({
      transport: "websocket",
      reason: "all_conditions_met",
    });
  });

  it("checks conditions in priority order (toggle first)", async () => {
    // Toggle off should short-circuit before checking other conditions
    isResponsesWebSocketEnabledMock.mockResolvedValue(false);

    const session = createMinimalSession("/v1/messages");
    const provider = createMinimalProvider({ providerType: "claude" });

    const result = await classifyTransport(session, provider);

    // Should return websocket_disabled, not any other reason
    expect(result.reason).toBe("websocket_disabled");
  });
});

// ---------------------------------------------------------------------------
// toWebSocketUrl
// ---------------------------------------------------------------------------

describe("toWebSocketUrl", () => {
  it("converts https:// to wss:// correctly", () => {
    const result = toWebSocketUrl("https://api.openai.com");
    expect(result).toBe("wss://api.openai.com/v1/responses");
  });

  it("appends /v1/responses if not present", () => {
    const result = toWebSocketUrl("https://api.openai.com/some/path");
    expect(result).toBe("wss://api.openai.com/some/path/v1/responses");
  });

  it("preserves existing /v1/responses path", () => {
    const result = toWebSocketUrl("https://api.openai.com/v1/responses");
    expect(result).toBe("wss://api.openai.com/v1/responses");
  });

  it("handles trailing slash in base URL", () => {
    const result = toWebSocketUrl("https://api.openai.com/");
    expect(result).toBe("wss://api.openai.com/v1/responses");
  });

  it("preserves port number", () => {
    const result = toWebSocketUrl("https://localhost:8443");
    expect(result).toBe("wss://localhost:8443/v1/responses");
  });

  it("handles URL with existing path segments", () => {
    const result = toWebSocketUrl("https://proxy.example.com/api/v2");
    expect(result).toBe("wss://proxy.example.com/api/v2/v1/responses");
  });
});
