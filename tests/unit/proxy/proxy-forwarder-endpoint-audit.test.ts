import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    getPreferredProviderEndpoints: vi.fn(),
    recordEndpointSuccess: vi.fn(async () => {}),
    recordEndpointFailure: vi.fn(async () => {}),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(async () => {}),
    getCircuitState: vi.fn(() => "closed"),
    getProviderHealthInfo: vi.fn(async () => ({
      health: { failureCount: 0 },
      config: { failureThreshold: 3 },
    })),
    isVendorTypeCircuitOpen: vi.fn(async () => false),
    recordVendorTypeAllEndpointsTimeout: vi.fn(async () => {}),
    categorizeErrorAsync: vi.fn(),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/provider-endpoints/endpoint-selector", () => ({
  getPreferredProviderEndpoints: mocks.getPreferredProviderEndpoints,
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointSuccess: mocks.recordEndpointSuccess,
  recordEndpointFailure: mocks.recordEndpointFailure,
}));

vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: mocks.getCircuitState,
  getProviderHealthInfo: mocks.getProviderHealthInfo,
  recordSuccess: mocks.recordSuccess,
  recordFailure: mocks.recordFailure,
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: mocks.isVendorTypeCircuitOpen,
  recordVendorTypeAllEndpointsTimeout: mocks.recordVendorTypeAllEndpointsTimeout,
}));

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    categorizeErrorAsync: mocks.categorizeErrorAsync,
  };
});

import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider, ProviderEndpoint, ProviderType } from "@/types/provider";

function makeEndpoint(input: {
  id: number;
  vendorId: number;
  providerType: ProviderType;
  url: string;
}): ProviderEndpoint {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: input.id,
    vendorId: input.vendorId,
    providerType: input.providerType,
    url: input.url,
    label: null,
    sortOrder: 0,
    isEnabled: true,
    lastProbedAt: null,
    lastProbeOk: null,
    lastProbeStatusCode: null,
    lastProbeLatencyMs: null,
    lastProbeErrorType: null,
    lastProbeErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "p1",
    url: "https://provider.example.com",
    key: "k",
    providerVendorId: 123,
    isEnabled: true,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    groupTag: null,
    providerType: "claude",
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    joinClaudePool: false,
    codexInstructionsStrategy: "auto",
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
    circuitBreakerOpenDuration: 1_800_000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30_000,
    streamingIdleTimeoutMs: 10_000,
    requestTimeoutNonStreamingMs: 600_000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    tpm: 0,
    rpm: 0,
    rpd: 0,
    cc: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function createSession(requestUrl: URL = new URL("https://example.com/v1/messages")): ProxySession {
  const headers = new Headers();
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl,
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "model-x",
      log: "(test)",
      message: {
        model: "model-x",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "ok" },
        ],
      },
    },
    userAgent: null,
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: null,
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
    isHeaderModified: () => false,
  });

  return session as ProxySession;
}

describe("ProxyForwarder - endpoint audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("成功时应记录 endpointId 且对 endpointUrl 做脱敏", async () => {
    const session = createSession();
    const provider = createProvider({ providerType: "claude", providerVendorId: 123 });
    session.setProvider(provider);

    mocks.getPreferredProviderEndpoints.mockResolvedValue([
      makeEndpoint({
        id: 42,
        vendorId: 123,
        providerType: provider.providerType,
        url: "https://api.example.com/v1/messages?api_key=SECRET&foo=bar",
      }),
    ]);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "2",
        },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(response.status).toBe(200);

    const chain = session.getProviderChain();
    expect(chain).toHaveLength(1);

    const item = chain[0];
    expect(item).toEqual(
      expect.objectContaining({
        reason: "request_success",
        attemptNumber: 1,
        statusCode: 200,
        vendorId: 123,
        providerType: "claude",
        endpointId: 42,
      })
    );

    expect(item.endpointUrl).toContain("[REDACTED]");
    expect(item.endpointUrl).not.toContain("SECRET");
  });

  test("重试时应分别记录每次 attempt 的 endpoint 审计字段", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession(new URL("https://example.com/v1/chat/completions"));
      const provider = createProvider({
        providerType: "openai-compatible",
        providerVendorId: 123,
      });
      session.setProvider(provider);

      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: provider.providerType,
          url: "https://api.example.com/v1?token=SECRET_1",
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: provider.providerType,
          url: "https://api.example.com/v1?api_key=SECRET_2",
        }),
      ]);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      // Throw network error (SYSTEM_ERROR) to trigger endpoint switching
      // PROVIDER_ERROR (HTTP 4xx/5xx) doesn't trigger endpoint switch, only SYSTEM_ERROR does
      doForward.mockImplementationOnce(async () => {
        const err = new Error("ECONNREFUSED") as NodeJS.ErrnoException;
        err.code = "ECONNREFUSED";
        throw err;
      });
      // Configure categorizeErrorAsync to return SYSTEM_ERROR for network errors
      mocks.categorizeErrorAsync.mockResolvedValueOnce(1); // ErrorCategory.SYSTEM_ERROR = 1
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "2",
          },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(100);
      const response = await sendPromise;
      expect(response.status).toBe(200);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(2);

      const first = chain[0];
      const second = chain[1];

      expect(first).toEqual(
        expect.objectContaining({
          reason: "system_error",
          attemptNumber: 1,
          vendorId: 123,
          providerType: "openai-compatible",
          endpointId: 1,
        })
      );
      expect(first.endpointUrl).toContain("[REDACTED]");
      expect(first.endpointUrl).not.toContain("SECRET_1");

      expect(second).toEqual(
        expect.objectContaining({
          reason: "retry_success",
          attemptNumber: 2,
          vendorId: 123,
          providerType: "openai-compatible",
          endpointId: 2,
        })
      );
      expect(second.endpointUrl).toContain("[REDACTED]");
      expect(second.endpointUrl).not.toContain("SECRET_2");
    } finally {
      vi.useRealTimers();
    }
  });

  test("endpoint 选择失败时应回退到 provider.url，并记录 endpointId=null", async () => {
    const session = createSession();
    const provider = createProvider({
      providerType: "claude",
      providerVendorId: 123,
      url: "https://provider.example.com/v1/messages?key=SECRET",
    });
    session.setProvider(provider);

    mocks.getPreferredProviderEndpoints.mockRejectedValue(new Error("boom"));

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "2",
        },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(response.status).toBe(200);

    const chain = session.getProviderChain();
    expect(chain).toHaveLength(1);

    const item = chain[0];
    expect(item).toEqual(
      expect.objectContaining({
        endpointId: null,
      })
    );
    expect(item.endpointUrl).toContain("[REDACTED]");
    expect(item.endpointUrl).not.toContain("SECRET");
  });
});
