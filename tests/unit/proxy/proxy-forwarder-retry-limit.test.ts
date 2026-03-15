import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { V1_ENDPOINT_PATHS } from "@/app/v1/_lib/proxy/endpoint-paths";

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
    getCachedSystemSettings: vi.fn(async () => {
      const now = new Date("2026-01-01T00:00:00.000Z");
      return {
        id: 0,
        siteTitle: "Claude Code Hub",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        timezone: null,
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        verboseProviderError: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        enableThinkingSignatureRectifier: true,
        enableThinkingBudgetRectifier: true,
        enableBillingHeaderRectifier: true,
        enableResponseInputRectifier: true,
        enableCodexSessionIdCompletion: true,
        enableClaudeMetadataUserIdInjection: true,
        enableResponseFixer: true,
        responseFixerConfig: {
          fixTruncatedJson: true,
          fixSseFormat: true,
          fixEncoding: true,
          maxJsonDepth: 200,
          maxFixSize: 1024 * 1024,
        },
        quotaDbRefreshIntervalSeconds: 10,
        quotaLeasePercent5h: 0.05,
        quotaLeasePercentDaily: 0.05,
        quotaLeasePercentWeekly: 0.05,
        quotaLeasePercentMonthly: 0.05,
        quotaLeaseCapUsd: null,
        createdAt: now,
        updatedAt: now,
      };
    }),
    isHttp2Enabled: vi.fn(async () => false),
    isVendorTypeCircuitOpen: vi.fn(async () => false),
    recordVendorTypeAllEndpointsTimeout: vi.fn(async () => {}),
    findAllProviders: vi.fn(async () => []),
    getCachedProviders: vi.fn(async () => []),
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

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getCachedSystemSettings: mocks.getCachedSystemSettings,
    isHttp2Enabled: mocks.isHttp2Enabled,
  };
});

vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: mocks.isVendorTypeCircuitOpen,
  recordVendorTypeAllEndpointsTimeout: mocks.recordVendorTypeAllEndpointsTimeout,
}));

vi.mock("@/repository/provider", () => ({
  findAllProviders: mocks.findAllProviders,
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  getCachedProviders: mocks.getCachedProviders,
}));

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    categorizeErrorAsync: vi.fn(async () => actual.ErrorCategory.PROVIDER_ERROR),
  };
});

import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxyError, ErrorCategory, categorizeErrorAsync } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import {
  MAX_THINKING_BUDGET,
  MAX_TOKENS_VALUE,
} from "@/app/v1/_lib/proxy/thinking-budget-rectifier";
import type { Provider, ProviderEndpoint, ProviderType } from "@/types/provider";

function makeEndpoint(input: {
  id: number;
  vendorId: number;
  providerType: ProviderType;
  url: string;
  lastProbeLatencyMs?: number | null;
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
    lastProbeOk: true,
    lastProbeStatusCode: 200,
    lastProbeLatencyMs: input.lastProbeLatencyMs ?? null,
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
    name: "test-provider",
    url: "https://provider.example.com",
    key: "test-key",
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
      model: "claude-3-opus",
      log: "(test)",
      message: {
        model: "claude-3-opus",
        messages: [{ role: "user", content: "hello" }],
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
    endpointPolicy: resolveEndpointPolicy(requestUrl.pathname),
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    providersSnapshot: [],
    isHeaderModified: () => false,
  });

  return session as ProxySession;
}

describe("ProxyForwarder - raw passthrough policy parity (T5 RED)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.PROVIDER_ERROR);
  });

  test.each([
    V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS,
    V1_ENDPOINT_PATHS.RESPONSES_COMPACT,
  ])("RED: %s 失败时都应统一为 no-retry/no-switch/no-circuit（Wave2 未实现前应失败）", async (pathname) => {
    vi.useFakeTimers();

    try {
      const session = createSession(new URL(`https://example.com${pathname}`));
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 3,
      });
      session.setProvider(provider);

      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
        }),
      ]);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      doForward.mockImplementation(async () => {
        throw new ProxyError("upstream failed", 500);
      });

      const sendPromise = ProxyForwarder.send(session);
      const rejection = expect(sendPromise).rejects.toBeInstanceOf(ProxyError);
      await vi.runAllTimersAsync();
      await rejection;
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(selectAlternative).not.toHaveBeenCalled();
      expect(mocks.recordFailure).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ProxyForwarder - maxRetryAttempts should not be bypassed by thinking rectifiers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("thinking signature rectifier: maxRetryAttempts=1 should switch provider (not retry same provider)", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 1,
      });
      const providerB = createProvider({
        id: 2,
        name: "p2",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 1,
      });
      session.setProvider(providerA);

      // Make rectifier actually apply: include a thinking block to be removed.
      (session.request.message as any).messages = [
        {
          role: "user",
          content: [
            { type: "thinking", text: "t" },
            { type: "text", text: "hello" },
          ],
        },
      ];

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      selectAlternative.mockResolvedValueOnce(providerB);

      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("invalid signature in thinking block", 400);
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.runAllTimersAsync();
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(2);

      const providerIds = doForward.mock.calls.map((call) => (call[1] as Provider).id);
      expect(providerIds).toEqual([1, 2]);

      const attemptNumbers = doForward.mock.calls.map((call) => call[4] as number);
      expect(attemptNumbers).toEqual([1, 1]);

      const content = (session.request.message as any).messages?.[0]?.content;
      expect(Array.isArray(content)).toBe(true);
      expect(content.some((b: any) => b?.type === "thinking")).toBe(false);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(2);
      expect(chain[0].id).toBe(1);
      expect(chain[1].id).toBe(2);

      expect(selectAlternative).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("thinking budget rectifier: maxRetryAttempts=1 should switch provider (not retry same provider)", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 1,
      });
      const providerB = createProvider({
        id: 2,
        name: "p2",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 1,
      });
      session.setProvider(providerA);

      // Make budget rectifier apply by setting low budget_tokens.
      (session.request.message as any).thinking = { type: "enabled", budget_tokens: 1 };
      delete (session.request.message as any).max_tokens;

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      selectAlternative.mockResolvedValueOnce(providerB);

      doForward.mockImplementationOnce(async () => {
        throw new ProxyError(
          "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024",
          400
        );
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.runAllTimersAsync();
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(2);

      const providerIds = doForward.mock.calls.map((call) => (call[1] as Provider).id);
      expect(providerIds).toEqual([1, 2]);

      const attemptNumbers = doForward.mock.calls.map((call) => call[4] as number);
      expect(attemptNumbers).toEqual([1, 1]);

      const thinking = (session.request.message as any).thinking;
      expect(thinking.type).toBe("enabled");
      expect(thinking.budget_tokens).toBe(MAX_THINKING_BUDGET);
      expect((session.request.message as any).max_tokens).toBe(MAX_TOKENS_VALUE);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(2);
      expect(chain[0].id).toBe(1);
      expect(chain[1].id).toBe(2);

      expect(selectAlternative).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("thinking signature rectifier: maxRetryAttempts=1 + no alternative provider should throw original 400 (not 503)", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 1,
      });
      session.setProvider(providerA);

      (session.request.message as any).messages = [
        {
          role: "user",
          content: [
            { type: "thinking", text: "t" },
            { type: "text", text: "hello" },
          ],
        },
      ];

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      selectAlternative.mockResolvedValueOnce(null);
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("invalid signature in thinking block", 400);
      });

      const sendPromise = ProxyForwarder.send(session);
      const instanceCheck = expect(sendPromise).rejects.toBeInstanceOf(ProxyError);
      const statusCheck = expect(sendPromise).rejects.toMatchObject({ statusCode: 400 });
      await vi.runAllTimersAsync();
      await instanceCheck;
      await statusCheck;
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(selectAlternative).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("thinking budget rectifier: maxRetryAttempts=1 + no alternative provider should throw original 400 (not 503)", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 1,
      });
      session.setProvider(providerA);

      (session.request.message as any).thinking = { type: "enabled", budget_tokens: 1 };
      delete (session.request.message as any).max_tokens;

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      selectAlternative.mockResolvedValueOnce(null);
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError(
          "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024",
          400
        );
      });

      const sendPromise = ProxyForwarder.send(session);
      const instanceCheck = expect(sendPromise).rejects.toBeInstanceOf(ProxyError);
      const statusCheck = expect(sendPromise).rejects.toMatchObject({ statusCode: 400 });
      await vi.runAllTimersAsync();
      await instanceCheck;
      await statusCheck;
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(selectAlternative).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("thinking signature rectifier: maxRetryAttempts=2 should retry same provider (not switch)", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 2,
      });
      session.setProvider(providerA);

      (session.request.message as any).messages = [
        {
          role: "user",
          content: [
            { type: "thinking", text: "t" },
            { type: "text", text: "hello" },
          ],
        },
      ];

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("invalid signature in thinking block", 400);
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.runAllTimersAsync();
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(2);
      expect(selectAlternative).not.toHaveBeenCalled();

      const providerIds = doForward.mock.calls.map((call) => (call[1] as Provider).id);
      expect(providerIds).toEqual([1, 1]);

      const attemptNumbers = doForward.mock.calls.map((call) => call[4] as number);
      expect(attemptNumbers).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("thinking budget rectifier: maxRetryAttempts=2 should retry same provider (not switch)", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 2,
      });
      session.setProvider(providerA);

      (session.request.message as any).thinking = { type: "enabled", budget_tokens: 1 };
      delete (session.request.message as any).max_tokens;

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      doForward.mockImplementationOnce(async () => {
        throw new ProxyError(
          "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024",
          400
        );
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.runAllTimersAsync();
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(2);
      expect(selectAlternative).not.toHaveBeenCalled();

      const providerIds = doForward.mock.calls.map((call) => (call[1] as Provider).id);
      expect(providerIds).toEqual([1, 1]);

      const attemptNumbers = doForward.mock.calls.map((call) => call[4] as number);
      expect(attemptNumbers).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("thinking signature rectifier: maxRetryAttempts=2 + retry still fails should throw original 400 (no switch)", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 2,
      });
      session.setProvider(providerA);

      // Make rectifier actually apply: include a thinking block to be removed.
      (session.request.message as any).messages = [
        {
          role: "user",
          content: [
            { type: "thinking", text: "t" },
            { type: "text", text: "hello" },
          ],
        },
      ];

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("invalid signature in thinking block", 400);
      });
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("invalid signature in thinking block", 400);
      });

      const sendPromise = ProxyForwarder.send(session);
      const instanceCheck = expect(sendPromise).rejects.toBeInstanceOf(ProxyError);
      const statusCheck = expect(sendPromise).rejects.toMatchObject({ statusCode: 400 });
      await vi.runAllTimersAsync();
      await instanceCheck;
      await statusCheck;

      expect(doForward).toHaveBeenCalledTimes(2);
      expect(selectAlternative).not.toHaveBeenCalled();
      expect(mocks.recordFailure).not.toHaveBeenCalled();

      const providerIds = doForward.mock.calls.map((call) => (call[1] as Provider).id);
      expect(providerIds).toEqual([1, 1]);

      const attemptNumbers = doForward.mock.calls.map((call) => call[4] as number);
      expect(attemptNumbers).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("thinking budget rectifier: maxRetryAttempts=2 + retry still fails should throw original 400 (no switch)", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 2,
      });
      session.setProvider(providerA);

      (session.request.message as any).thinking = { type: "enabled", budget_tokens: 1 };
      delete (session.request.message as any).max_tokens;

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      doForward.mockImplementationOnce(async () => {
        throw new ProxyError(
          "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024",
          400
        );
      });
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError(
          "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024",
          400
        );
      });

      const sendPromise = ProxyForwarder.send(session);
      const instanceCheck = expect(sendPromise).rejects.toBeInstanceOf(ProxyError);
      const statusCheck = expect(sendPromise).rejects.toMatchObject({ statusCode: 400 });
      await vi.runAllTimersAsync();
      await instanceCheck;
      await statusCheck;

      expect(doForward).toHaveBeenCalledTimes(2);
      expect(selectAlternative).not.toHaveBeenCalled();
      expect(mocks.recordFailure).not.toHaveBeenCalled();

      const providerIds = doForward.mock.calls.map((call) => (call[1] as Provider).id);
      expect(providerIds).toEqual([1, 1]);

      const attemptNumbers = doForward.mock.calls.map((call) => call[4] as number);
      expect(attemptNumbers).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("streaming hedge + thinking signature rectifier: maxRetryAttempts=1 should switch provider", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      (session.request.message as any).stream = true;

      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 1,
      });
      const providerB = createProvider({
        id: 2,
        name: "p2",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 1,
      });
      session.setProvider(providerA);

      // Make rectifier actually apply: include a thinking block to be removed.
      (session.request.message as any).messages = [
        {
          role: "user",
          content: [
            { type: "thinking", text: "t" },
            { type: "text", text: "hello" },
          ],
        },
      ];

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      selectAlternative.mockResolvedValueOnce(providerB);

      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("invalid signature in thinking block", 400);
      });
      doForward.mockResolvedValueOnce(
        new Response("data", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );

      const response = await ProxyForwarder.send(session);
      expect(response.status).toBe(200);

      expect(doForward).toHaveBeenCalledTimes(2);
      expect(selectAlternative).toHaveBeenCalledTimes(1);
      expect(mocks.recordFailure).not.toHaveBeenCalled();

      const providerIds = doForward.mock.calls.map((call) => (call[1] as Provider).id);
      expect(providerIds).toEqual([1, 2]);

      const attemptNumbers = doForward.mock.calls.map((call) => call[4] as number);
      expect(attemptNumbers).toEqual([1, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("streaming hedge + thinking signature rectifier: maxRetryAttempts=2 should retry same provider", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      (session.request.message as any).stream = true;

      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 2,
      });
      session.setProvider(providerA);

      (session.request.message as any).messages = [
        {
          role: "user",
          content: [
            { type: "thinking", text: "t" },
            { type: "text", text: "hello" },
          ],
        },
      ];

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("invalid signature in thinking block", 400);
      });
      doForward.mockResolvedValueOnce(
        new Response("data", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );

      const response = await ProxyForwarder.send(session);
      expect(response.status).toBe(200);

      expect(doForward).toHaveBeenCalledTimes(2);
      expect(selectAlternative).not.toHaveBeenCalled();
      expect(mocks.recordFailure).not.toHaveBeenCalled();

      const providerIds = doForward.mock.calls.map((call) => (call[1] as Provider).id);
      expect(providerIds).toEqual([1, 1]);

      const attemptNumbers = doForward.mock.calls.map((call) => call[4] as number);
      expect(attemptNumbers).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("streaming hedge + thinking budget rectifier: maxRetryAttempts=1 should switch provider", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      (session.request.message as any).stream = true;

      const providerA = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 1,
      });
      const providerB = createProvider({
        id: 2,
        name: "p2",
        providerType: "claude",
        providerVendorId: null,
        maxRetryAttempts: 1,
      });
      session.setProvider(providerA);

      (session.request.message as any).thinking = { type: "enabled", budget_tokens: 1 };
      delete (session.request.message as any).max_tokens;

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      const selectAlternative = vi.spyOn(
        ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
        "selectAlternative"
      );

      selectAlternative.mockResolvedValueOnce(providerB);

      doForward.mockImplementationOnce(async () => {
        throw new ProxyError(
          "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024",
          400
        );
      });
      doForward.mockResolvedValueOnce(
        new Response("data", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );

      const response = await ProxyForwarder.send(session);
      expect(response.status).toBe(200);

      expect(doForward).toHaveBeenCalledTimes(2);
      expect(selectAlternative).toHaveBeenCalledTimes(1);
      expect(mocks.recordFailure).not.toHaveBeenCalled();

      const providerIds = doForward.mock.calls.map((call) => (call[1] as Provider).id);
      expect(providerIds).toEqual([1, 2]);

      const attemptNumbers = doForward.mock.calls.map((call) => call[4] as number);
      expect(attemptNumbers).toEqual([1, 1]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ProxyForwarder - retry limit enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("endpoints > maxRetry: should only use top N lowest-latency endpoints", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      // Configure provider with maxRetryAttempts=2 but 4 endpoints available
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 2,
      });
      session.setProvider(provider);

      // Return 4 endpoints sorted by latency (lowest first)
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
        makeEndpoint({
          id: 4,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep4.example.com",
          lastProbeLatencyMs: 400,
        }),
      ]);

      // Use SYSTEM_ERROR to trigger endpoint switching on retry
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // Create a network-like error
      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });

      // First attempt fails with network error, second succeeds
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(100);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      // Should only call doForward twice (maxRetryAttempts=2)
      expect(doForward).toHaveBeenCalledTimes(2);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(2);

      // First attempt should use endpoint 1 (lowest latency)
      expect(chain[0].endpointId).toBe(1);
      expect(chain[0].attemptNumber).toBe(1);

      // Second attempt should use endpoint 2 (SYSTEM_ERROR advances endpoint)
      expect(chain[1].endpointId).toBe(2);
      expect(chain[1].attemptNumber).toBe(2);

      // Endpoints 3 and 4 should NOT be used
    } finally {
      vi.useRealTimers();
    }
  });

  test("endpoints < maxRetry: should stay at last endpoint after exhausting all (no wrap-around)", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      // Configure provider with maxRetryAttempts=5 but only 2 endpoints
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 5,
      });
      session.setProvider(provider);

      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
      ]);

      // Use SYSTEM_ERROR to trigger endpoint switching
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });

      // First 4 attempts fail, 5th succeeds
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(500);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      // Should call doForward 5 times (maxRetryAttempts=5)
      expect(doForward).toHaveBeenCalledTimes(5);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(5);

      // Verify NO wrap-around pattern: 1, 2, 2, 2, 2 (stays at last endpoint)
      expect(chain[0].endpointId).toBe(1);
      expect(chain[1].endpointId).toBe(2);
      expect(chain[2].endpointId).toBe(2); // stays at endpoint 2
      expect(chain[3].endpointId).toBe(2);
      expect(chain[4].endpointId).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("endpoints = maxRetry: each endpoint should be tried exactly once with SYSTEM_ERROR", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      // Configure provider with maxRetryAttempts=3 and 3 endpoints
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 3,
      });
      session.setProvider(provider);

      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
      ]);

      // Use SYSTEM_ERROR to trigger endpoint switching
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });

      // First two fail with network error, third succeeds
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(300);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(3);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(3);

      // Each endpoint tried exactly once (SYSTEM_ERROR advances endpoint)
      expect(chain[0].endpointId).toBe(1);
      expect(chain[1].endpointId).toBe(2);
      expect(chain[2].endpointId).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("MCP request: should use provider.url only, ignore vendor endpoints", async () => {
    const session = createSession(new URL("https://example.com/mcp/custom-endpoint"));
    const provider = createProvider({
      providerType: "claude",
      providerVendorId: 123,
      maxRetryAttempts: 2,
      url: "https://provider.example.com/mcp",
    });
    session.setProvider(provider);

    // Even if endpoints are available, MCP should not use them
    mocks.getPreferredProviderEndpoints.mockResolvedValue([
      makeEndpoint({
        id: 1,
        vendorId: 123,
        providerType: "claude",
        url: "https://ep1.example.com",
      }),
      makeEndpoint({
        id: 2,
        vendorId: 123,
        providerType: "claude",
        url: "https://ep2.example.com",
      }),
    ]);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "2" },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(response.status).toBe(200);

    // getPreferredProviderEndpoints should NOT be called for MCP requests
    expect(mocks.getPreferredProviderEndpoints).not.toHaveBeenCalled();

    const chain = session.getProviderChain();
    expect(chain).toHaveLength(1);
    // endpointId should be null (using provider.url)
    expect(chain[0].endpointId).toBeNull();
  });

  test("no vendor endpoints: should use provider.url with configured maxRetry", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      // Provider without vendorId
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: null as unknown as number,
        maxRetryAttempts: 3,
        url: "https://provider.example.com",
      });
      session.setProvider(provider);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // First two fail, third succeeds
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("failed", 500);
      });
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("failed", 500);
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(300);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      // Should retry up to maxRetryAttempts times
      expect(doForward).toHaveBeenCalledTimes(3);

      // getPreferredProviderEndpoints should NOT be called (no vendorId)
      expect(mocks.getPreferredProviderEndpoints).not.toHaveBeenCalled();

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(3);
      // All attempts should use provider.url (endpointId=null)
      expect(chain[0].endpointId).toBeNull();
      expect(chain[1].endpointId).toBeNull();
      expect(chain[2].endpointId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("all retries exhausted: should not exceed maxRetryAttempts", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 2,
      });
      session.setProvider(provider);

      // 4 endpoints available but maxRetry=2
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
        makeEndpoint({
          id: 4,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep4.example.com",
          lastProbeLatencyMs: 400,
        }),
      ]);

      // Use SYSTEM_ERROR to trigger endpoint switching
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });

      // All attempts fail
      doForward.mockImplementation(async () => {
        throw networkError;
      });

      const sendPromise = ProxyForwarder.send(session);
      const rejection = expect(sendPromise).rejects.toBeInstanceOf(ProxyError);
      await vi.runAllTimersAsync();
      await rejection;

      // Should only call doForward twice (maxRetryAttempts=2), NOT 4 times
      expect(doForward).toHaveBeenCalledTimes(2);

      const chain = session.getProviderChain();
      // Only 2 attempts recorded
      expect(chain).toHaveLength(2);
      expect(chain[0].endpointId).toBe(1);
      expect(chain[1].endpointId).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("524 with endpoint pool: should keep retrying until maxRetryAttempts before vendor_type_all_timeout", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 5,
      });
      session.setProvider(provider);

      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
      ]);

      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.PROVIDER_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      doForward.mockImplementation(async () => {
        throw new ProxyError("provider timeout", 524, {
          body: "",
          providerId: provider.id,
          providerName: provider.name,
        });
      });

      const sendPromise = ProxyForwarder.send(session);
      let caughtError: Error | null = null;
      sendPromise.catch((error) => {
        caughtError = error as Error;
      });
      await vi.runAllTimersAsync();

      expect(caughtError).not.toBeNull();
      expect(caughtError).toBeInstanceOf(ProxyError);
      expect(doForward).toHaveBeenCalledTimes(5);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(5);
      expect(chain.map((item) => item.endpointId)).toEqual([1, 2, 2, 2, 2]);

      const vendorTimeoutItems = chain.filter((item) => item.reason === "vendor_type_all_timeout");
      expect(vendorTimeoutItems).toHaveLength(1);
      expect(vendorTimeoutItems[0]?.attemptNumber).toBe(5);

      expect(mocks.recordVendorTypeAllEndpointsTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("524 with endpoint pool: maxRetryAttempts=2 should stop at budget exhaustion", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 2,
      });
      session.setProvider(provider);

      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
      ]);

      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.PROVIDER_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      doForward.mockImplementation(async () => {
        throw new ProxyError("provider timeout", 524, {
          body: "",
          providerId: provider.id,
          providerName: provider.name,
        });
      });

      const sendPromise = ProxyForwarder.send(session);
      let caughtError: Error | null = null;
      sendPromise.catch((error) => {
        caughtError = error as Error;
      });
      await vi.runAllTimersAsync();

      expect(caughtError).not.toBeNull();
      expect(caughtError).toBeInstanceOf(ProxyError);
      expect(doForward).toHaveBeenCalledTimes(2);

      const chain = session.getProviderChain();
      expect(chain.map((item) => item.endpointId)).toEqual([1, 2]);

      const vendorTimeoutItems = chain.filter((item) => item.reason === "vendor_type_all_timeout");
      expect(vendorTimeoutItems).toHaveLength(1);
      expect(vendorTimeoutItems[0]?.attemptNumber).toBe(2);

      expect(mocks.recordVendorTypeAllEndpointsTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ProxyForwarder - endpoint stickiness on retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default PROVIDER_ERROR behavior
    vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.PROVIDER_ERROR);
  });

  test("SYSTEM_ERROR: should switch to next endpoint on each network error retry", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 3,
      });
      session.setProvider(provider);

      // 3 endpoints sorted by latency
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
      ]);

      // Mock categorizeErrorAsync to return SYSTEM_ERROR (network error)
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // Create a network-like error (not ProxyError)
      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });

      // First two fail with network error, third succeeds
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(300);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(3);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(3);

      // Network error should switch to next endpoint on each retry
      // attempt 1: endpoint 1, attempt 2: endpoint 2, attempt 3: endpoint 3
      expect(chain[0].endpointId).toBe(1);
      expect(chain[0].attemptNumber).toBe(1);
      expect(chain[1].endpointId).toBe(2);
      expect(chain[1].attemptNumber).toBe(2);
      expect(chain[2].endpointId).toBe(3);
      expect(chain[2].attemptNumber).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("PROVIDER_ERROR: should keep same endpoint on non-network error retry", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 3,
      });
      session.setProvider(provider);

      // 3 endpoints sorted by latency
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
      ]);

      // Mock categorizeErrorAsync to return PROVIDER_ERROR (HTTP error, not network)
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.PROVIDER_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // First two fail with HTTP 500, third succeeds
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("server error", 500);
      });
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("server error", 500);
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(300);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(3);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(3);

      // Non-network error should keep same endpoint on all retries
      // All 3 attempts should use endpoint 1 (sticky)
      expect(chain[0].endpointId).toBe(1);
      expect(chain[0].attemptNumber).toBe(1);
      expect(chain[1].endpointId).toBe(1);
      expect(chain[1].attemptNumber).toBe(2);
      expect(chain[2].endpointId).toBe(1);
      expect(chain[2].attemptNumber).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("SYSTEM_ERROR: should not wrap around when endpoints exhausted", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 4, // More retries than endpoints
      });
      session.setProvider(provider);

      // Only 2 endpoints available
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
      ]);

      // Mock categorizeErrorAsync to return SYSTEM_ERROR (network error)
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // Create a network-like error
      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ETIMEDOUT" });

      // All 4 attempts fail with network error, then mock switches provider
      doForward.mockImplementation(async () => {
        throw networkError;
      });

      const sendPromise = ProxyForwarder.send(session);
      const rejection = expect(sendPromise).rejects.toBeInstanceOf(ProxyError);
      await vi.runAllTimersAsync();
      await rejection;

      const chain = session.getProviderChain();

      // Should have attempted with both endpoints, but NOT wrap around
      // Pattern should be: endpoint 1, endpoint 2, endpoint 2, endpoint 2 (stay at last)
      // NOT: endpoint 1, endpoint 2, endpoint 1, endpoint 2 (wrap around)
      expect(chain.length).toBeGreaterThanOrEqual(2);

      // First attempt uses endpoint 1
      expect(chain[0].endpointId).toBe(1);
      // Second attempt uses endpoint 2
      expect(chain[1].endpointId).toBe(2);

      // Subsequent attempts should stay at endpoint 2 (no wrap-around)
      if (chain.length > 2) {
        expect(chain[2].endpointId).toBe(2);
      }
      if (chain.length > 3) {
        expect(chain[3].endpointId).toBe(2);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("mixed errors: PROVIDER_ERROR should not advance endpoint index", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 4,
      });
      session.setProvider(provider);

      // 3 endpoints
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
      ]);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // Create errors
      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });
      const httpError = new ProxyError("server error", 500);

      // Attempt 1: SYSTEM_ERROR (switch endpoint)
      // Attempt 2: PROVIDER_ERROR (keep endpoint)
      // Attempt 3: SYSTEM_ERROR (switch endpoint)
      // Attempt 4: success
      let attemptCount = 0;
      vi.mocked(categorizeErrorAsync).mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) return ErrorCategory.SYSTEM_ERROR;
        if (attemptCount === 2) return ErrorCategory.PROVIDER_ERROR;
        if (attemptCount === 3) return ErrorCategory.SYSTEM_ERROR;
        return ErrorCategory.PROVIDER_ERROR;
      });

      doForward.mockImplementationOnce(async () => {
        throw networkError; // SYSTEM_ERROR -> advance to ep2
      });
      doForward.mockImplementationOnce(async () => {
        throw httpError; // PROVIDER_ERROR -> stay at ep2
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError; // SYSTEM_ERROR -> advance to ep3
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(500);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(4);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(4);

      // Verify endpoint progression:
      // attempt 1: ep1 (SYSTEM_ERROR -> advance)
      // attempt 2: ep2 (PROVIDER_ERROR -> stay)
      // attempt 3: ep2 (SYSTEM_ERROR -> advance)
      // attempt 4: ep3 (success)
      expect(chain[0].endpointId).toBe(1);
      expect(chain[1].endpointId).toBe(2);
      expect(chain[2].endpointId).toBe(2);
      expect(chain[3].endpointId).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("NON_RETRYABLE_CLIENT_ERROR regression tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPreferredProviderEndpoints.mockResolvedValue([
      makeEndpoint({ id: 1, vendorId: 1, providerType: "claude", url: "https://ep1.example.com" }),
    ]);
  });

  test("NON_RETRYABLE_CLIENT_ERROR with plain SocketError does not throw TypeError", async () => {
    // 1. Build a synthetic native transport error
    const socketErr = Object.assign(new Error("other side closed"), {
      name: "SocketError",
      code: "UND_ERR_SOCKET",
    });

    // 2. doForward always throws it
    const doForward = vi.spyOn(ProxyForwarder as unknown as { doForward: unknown }, "doForward");
    doForward.mockRejectedValue(socketErr);

    // 3. Force categorizeErrorAsync to return NON_RETRYABLE_CLIENT_ERROR (simulates regression)
    vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);

    const session = createSession(new URL("https://example.com/v1/messages"));
    const provider = createProvider({ id: 1, providerType: "claude", providerVendorId: 1 });
    session.setProvider(provider);

    // 4. Expect the original SocketError to be rethrown, NOT a TypeError
    await expect(ProxyForwarder.send(session)).rejects.toSatisfy((e: unknown) => {
      expect(e).toBe(socketErr); // same object reference
      return true;
    });

    // 5. Provider chain should have been recorded
    expect(session.getProviderChain()).toHaveLength(1);
    expect(session.getProviderChain()[0].reason).toBe("client_error_non_retryable");
  });

  test("categorizeErrorAsync returns SYSTEM_ERROR for SocketError even if rule would match", async () => {
    // Import real categorizeErrorAsync (not the mock from the forwarder test)
    const { categorizeErrorAsync: realCategorize, ErrorCategory: RealErrorCategory } =
      await vi.importActual<typeof import("@/app/v1/_lib/proxy/errors")>(
        "@/app/v1/_lib/proxy/errors"
      );

    const socketErr = Object.assign(new Error("other side closed"), {
      name: "SocketError",
      code: "UND_ERR_SOCKET",
    });

    const category = await realCategorize(socketErr);
    expect(category).toBe(RealErrorCategory.SYSTEM_ERROR);
  });
});
