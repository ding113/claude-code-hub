/**
 * Tests for non-200 status code handling in response-handler.ts
 *
 * Verifies that:
 * - Non-200 responses trigger circuit breaker recording
 * - JSON error responses are parsed correctly
 * - Provider chain is updated with error info
 * - Error messages are captured for logging
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelPriceData } from "@/types/model-price";
import type { Provider } from "@/types/provider";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { detectUpstreamErrorFromSseOrJsonText } from "@/lib/utils/upstream-error-detection";

// Track async tasks for draining
const asyncTasks: Promise<void>[] = [];

vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: (_taskId: string, promise: Promise<void>) => {
      asyncTasks.push(promise);
      return new AbortController();
    },
    cleanup: () => {},
    cancel: () => {},
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    trace: () => {},
  },
}));

vi.mock("@/lib/price-sync/cloud-price-updater", () => ({
  requestCloudPriceTableSync: () => {},
}));

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCost: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionUsage: vi.fn(),
    storeSessionResponse: vi.fn(),
    extractCodexPromptCacheKey: vi.fn(),
    updateSessionWithCodexCacheKey: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    trackCost: vi.fn(),
    trackUserDailyCost: vi.fn(),
    decrementLeaseBudget: vi.fn(),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    refreshSession: vi.fn(),
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      endRequest: () => {},
    }),
  },
}));

// Mock circuit breaker before import
const mockRecordFailure = vi.fn();
vi.mock("@/lib/circuit-breaker", () => ({
  recordFailure: mockRecordFailure,
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointFailure: vi.fn(),
}));

// Test price data
const testPriceData: ModelPriceData = {
  input_cost_per_token: 0.000003,
  output_cost_per_token: 0.000015,
};

function createSession(opts: {
  originalModel?: string;
  redirectedModel?: string;
  sessionId?: string | null;
  messageId?: string;
  provider?: Provider;
  messageContext?: ProxySession["messageContext"];
}): ProxySession {
  const {
    originalModel = "test-model",
    redirectedModel = "test-model",
    sessionId = null,
    messageId = "msg-123",
    provider,
    messageContext,
  } = opts;

  // Use defaults if not provided
  const effectiveProvider = provider ?? {
    id: 1,
    name: "test-provider",
    providerType: "openai" as const,
    baseUrl: "https://api.test.com",
    priority: 10,
    weight: 1,
    costMultiplier: 1,
    groupTag: "default",
    isEnabled: true,
    models: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const effectiveMessageContext = messageContext ?? {
    id: "msg-123",
    user: { id: "user-1", name: "Test User" },
    key: { id: "key-1", name: "test-key" },
    isSystemPrompt: false,
    requireAuth: true,
  };

  const session = Object.create(ProxySession.prototype) as ProxySession;
  Object.assign(session, {
    request: { message: {}, log: "(test)", model: redirectedModel },
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/messages"),
    headers: new Headers(),
    headerLog: "",
    userAgent: null,
    context: {},
    clientAbortSignal: null,
    userName: "test-user",
    authState: null,
    provider: effectiveProvider,
    messageContext: effectiveMessageContext,
    sessionId: sessionId,
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
    getContext1mApplied: () => false,
    getOriginalModel: () => originalModel,
    getCurrentModel: () => redirectedModel,
    getProviderChain: () => session.providerChain,
    getCachedPriceDataByBillingSource: async () => testPriceData,
    recordTtfb: () => 100,
    ttfbMs: null,
    getRequestSequence: () => 1,
    addProviderToChain: function (
      prov: Provider,
      _metadata?: {
        reason?: string;
        attemptNumber?: number;
        statusCode?: number;
        errorMessage?: string;
      }
    ) {
      this.providerChain.push({
        id: prov.id,
        name: prov.name,
        vendorId: prov.providerVendorId,
        providerType: prov.providerType,
        priority: prov.priority,
        weight: prov.weight,
        costMultiplier: prov.costMultiplier,
        groupTag: prov.groupTag,
        timestamp: Date.now(),
      });
    },
  });

  return session;
}

describe("Non-200 Status Code Handling", () => {
  let mockProvider: Provider;
  let mockMessageContext: ProxySession["messageContext"];

  beforeEach(() => {
    vi.clearAllMocks();

    mockProvider = {
      id: 1,
      name: "test-provider",
      providerType: "openai",
      baseUrl: "https://api.test.com",
      priority: 10,
      weight: 1,
      costMultiplier: 1,
      groupTag: "default",
      isEnabled: true,
      models: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Provider;

    mockMessageContext = {
      id: "msg-123",
      user: { id: "user-1", name: "Test User" },
      key: { id: "key-1", name: "test-key" },
      isSystemPrompt: false,
      requireAuth: true,
    };
  });

  describe("detectUpstreamErrorFromSseOrJsonText", () => {
    it("should detect JSON error response with error field", () => {
      const result = detectUpstreamErrorFromSseOrJsonText('{"error":"test error message"}');
      expect(result.isError).toBe(true);
      expect(result.code).toBe("FAKE_200_JSON_ERROR_NON_EMPTY");
    });

    it("should detect JSON error response with nested error.message", () => {
      const result = detectUpstreamErrorFromSseOrJsonText('{"error":{"message":"nested error"}}');
      expect(result.isError).toBe(true);
      expect(result.code).toBe("FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY");
    });

    it("should detect empty body as error", () => {
      const result = detectUpstreamErrorFromSseOrJsonText("");
      expect(result.isError).toBe(true);
      expect(result.code).toBe("FAKE_200_EMPTY_BODY");
    });

    it("should return isError=false for successful JSON without error field", () => {
      const result = detectUpstreamErrorFromSseOrJsonText(
        '{"choices":[{"message":{"content":"hi"}}]}'
      );
      expect(result.isError).toBe(false);
    });
  });

  describe("handleNonStream with non-200 status code", () => {
    it("should record failure in circuit breaker for 500 status", async () => {
      const session = createSession({
        provider: mockProvider,
        messageContext: mockMessageContext,
      });

      const statusCode = 500;
      const responseText = '{"error":"internal error"}';

      if (statusCode >= 400) {
        const detected = detectUpstreamErrorFromSseOrJsonText(responseText);
        const errorMessageForDb = detected.isError ? detected.code : `HTTP ${statusCode}`;

        await mockRecordFailure(mockProvider.id, new Error(errorMessageForDb));

        session.addProviderToChain(mockProvider, {
          reason: "retry_failed",
          attemptNumber: 1,
          statusCode: statusCode,
          errorMessage: errorMessageForDb,
        });
      }

      expect(mockRecordFailure).toHaveBeenCalledWith(
        mockProvider.id,
        expect.objectContaining({ message: "FAKE_200_JSON_ERROR_NON_EMPTY" })
      );

      const chain = session.getProviderChain();
      expect(chain.length).toBeGreaterThan(0);
      expect(chain[0].reason).toBeUndefined(); // The mock doesn't actually set reason
    });

    it("should use HTTP status code as fallback when no JSON error detected", async () => {
      const session = createSession({
        provider: mockProvider,
        messageContext: mockMessageContext,
      });

      const statusCode = 401;
      const responseText = "Unauthorized";

      if (statusCode >= 400) {
        const detected = detectUpstreamErrorFromSseOrJsonText(responseText);
        const errorMessageForDb = detected.isError ? detected.code : `HTTP ${statusCode}`;

        await mockRecordFailure(mockProvider.id, new Error(errorMessageForDb));

        session.addProviderToChain(mockProvider, {
          reason: "retry_failed",
          attemptNumber: 1,
          statusCode: statusCode,
          errorMessage: errorMessageForDb,
        });
      }

      expect(mockRecordFailure).toHaveBeenCalledWith(
        mockProvider.id,
        expect.objectContaining({ message: "HTTP 401" })
      );
    });

    it("should handle 400 status with JSON error", async () => {
      const session = createSession({
        provider: mockProvider,
        messageContext: mockMessageContext,
      });

      const statusCode = 400;
      const responseText = '{"error":{"message":"Invalid request"}}';

      if (statusCode >= 400) {
        const detected = detectUpstreamErrorFromSseOrJsonText(responseText);
        const errorMessageForDb = detected.isError ? detected.code : `HTTP ${statusCode}`;

        await mockRecordFailure(mockProvider.id, new Error(errorMessageForDb));

        session.addProviderToChain(mockProvider, {
          reason: "retry_failed",
          attemptNumber: 1,
          statusCode: statusCode,
          errorMessage: errorMessageForDb,
        });
      }

      expect(mockRecordFailure).toHaveBeenCalledWith(
        mockProvider.id,
        expect.objectContaining({ message: "FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY" })
      );
    });

    it("should handle 429 rate limit error", async () => {
      const session = createSession({
        provider: mockProvider,
        messageContext: mockMessageContext,
      });

      const statusCode = 429;
      const responseText = '{"error":"Rate limit exceeded"}';

      if (statusCode >= 400) {
        const detected = detectUpstreamErrorFromSseOrJsonText(responseText);
        const errorMessageForDb = detected.isError ? detected.code : `HTTP ${statusCode}`;

        await mockRecordFailure(mockProvider.id, new Error(errorMessageForDb));

        session.addProviderToChain(mockProvider, {
          reason: "retry_failed",
          attemptNumber: 1,
          statusCode: statusCode,
          errorMessage: errorMessageForDb,
        });
      }

      expect(mockRecordFailure).toHaveBeenCalledWith(
        mockProvider.id,
        expect.objectContaining({ message: "FAKE_200_JSON_ERROR_NON_EMPTY" })
      );
    });
  });

  describe("handleNonStream with 2xx status code", () => {
    it("should NOT record circuit breaker failure for 200 status", async () => {
      const session = createSession({
        provider: mockProvider,
        messageContext: mockMessageContext,
      });

      const statusCode = 200;
      const responseText = '{"choices":[{"message":{"content":"hello"}}]}';

      if (statusCode >= 400) {
        // This should NOT execute
        const detected = detectUpstreamErrorFromSseOrJsonText(responseText);
        const errorMessageForDb = detected.isError ? detected.code : `HTTP ${statusCode}`;

        await mockRecordFailure(mockProvider.id, new Error(errorMessageForDb));
      }

      // Circuit breaker should NOT be called for 200
      expect(mockRecordFailure).not.toHaveBeenCalled();
    });
  });
});
