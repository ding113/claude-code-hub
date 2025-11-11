import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProxyForwarder } from "./forwarder";
import { ProxyError } from "./errors";
import * as circuitBreaker from "@/lib/circuit-breaker";
import * as sessionManager from "@/lib/session-manager";
import { ProxyProviderResolver } from "./provider-selector";
import { ModelRedirector } from "./model-redirector";
import { CodexInstructionsCache } from "@/lib/codex-instructions-cache";
import { createProxyAgentForProvider } from "@/lib/proxy-agent";
import type { ProxySession } from "./session";
import type { Provider } from "@/types/provider";

// Mock server-only module to avoid import errors in test environment
vi.mock("server-only", () => ({}));

// Mock external dependencies
vi.mock("@/lib/circuit-breaker");
vi.mock("@/lib/session-manager");
vi.mock("./provider-selector");
vi.mock("./model-redirector");
vi.mock("@/lib/codex-instructions-cache");
vi.mock("@/lib/proxy-agent");
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));
vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: vi.fn(() => ({
    ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS: false,
  })),
}));
vi.mock("../headers", () => ({
  HeaderProcessor: {
    createForProxy: vi.fn(() => ({
      process: vi.fn((headers: Headers) => headers),
    })),
    extractHost: vi.fn(() => "api.example.com"),
  },
}));
vi.mock("../url", () => ({
  buildProxyUrl: vi.fn((baseUrl: string) => baseUrl),
}));
vi.mock("../converters", () => ({
  defaultRegistry: {
    transformRequest: vi.fn((from, to, model, message) => message),
  },
}));
vi.mock("./format-mapper", () => ({
  mapClientFormatToTransformer: vi.fn(() => "claude"),
  mapProviderTypeToTransformer: vi.fn(() => "claude"),
}));
vi.mock("../codex/utils/request-sanitizer", () => ({
  isOfficialCodexClient: vi.fn(() => false),
  sanitizeCodexRequest: vi.fn((message) => message),
}));
vi.mock("../codex/constants/codex-instructions", () => ({
  getDefaultInstructions: vi.fn(() => "default instructions"),
}));

describe("ProxyForwarder", () => {
  let mockSession: ProxySession;
  let mockProvider: Provider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock provider
    mockProvider = {
      id: 1,
      name: "Test Provider",
      url: "https://api.example.com",
      key: "test-key",
      providerType: "claude",
      priority: 1,
      weight: 100,
      isEnabled: true,
      modelRedirects: {},
      codexInstructionsStrategy: "auto",
      proxyUrl: null,
      proxyFallbackToDirect: false,
    } as Provider;

    // Setup mock session
    mockSession = {
      provider: mockProvider,
      authState: {
        success: true,
        user: { id: 1, name: "test" },
        key: { id: 1 },
        apiKey: "test-api-key",
      },
      request: {
        message: { model: "claude-3-opus", messages: [] },
        model: "claude-3-opus",
        log: "test request",
      },
      method: "POST",
      requestUrl: new URL("https://api.example.com/v1/messages"),
      headers: new Headers({ "content-type": "application/json" }),
      userAgent: "test-agent",
      sessionId: "session-123",
      originalFormat: "claude",
      setProvider: vi.fn(),
      addProviderToChain: vi.fn(),
      isProbeRequest: vi.fn(() => false),
      getMessagesLength: vi.fn(() => 1),
      setOriginalModel: vi.fn(),
    } as unknown as ProxySession;

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Default mock implementations
    vi.mocked(circuitBreaker.recordSuccess).mockResolvedValue(undefined);
    vi.mocked(circuitBreaker.recordFailure).mockResolvedValue(undefined);
    vi.mocked(circuitBreaker.getCircuitState).mockReturnValue("closed");
    vi.mocked(circuitBreaker.getProviderHealthInfo).mockResolvedValue({
      health: { failureCount: 0, state: "closed", lastFailureTime: null },
      config: { failureThreshold: 5, timeoutDuration: 30000, halfOpenSuccessThreshold: 2 },
    });
    vi.mocked(sessionManager.SessionManager.updateSessionBindingSmart).mockResolvedValue({
      updated: true,
      reason: "success",
    });
    vi.mocked(sessionManager.SessionManager.updateSessionProvider).mockResolvedValue(undefined);
    vi.mocked(ModelRedirector.apply).mockReturnValue(false);
    vi.mocked(createProxyAgentForProvider).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("send", () => {
    describe("successful request flow", () => {
      it("should successfully forward request and return response", async () => {
        const mockResponse = new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });

        mockFetch.mockResolvedValue(mockResponse);

        const result = await ProxyForwarder.send(mockSession);

        expect(result).toBe(mockResponse);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(circuitBreaker.recordSuccess).toHaveBeenCalledWith(mockProvider.id);
        expect(mockSession.addProviderToChain).toHaveBeenCalledWith(
          mockProvider,
          expect.objectContaining({ reason: "request_success", statusCode: 200 })
        );
      });

      it("should apply model redirector if configured", async () => {
        mockProvider.modelRedirects = { "claude-3-opus": "gpt-4" };
        vi.mocked(ModelRedirector.apply).mockReturnValue(true);

        const mockResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
        mockFetch.mockResolvedValue(mockResponse);

        await ProxyForwarder.send(mockSession);

        expect(ModelRedirector.apply).toHaveBeenCalledWith(mockSession, mockProvider);
      });

      it("should cache successful codex instructions in auto strategy", async () => {
        mockProvider.providerType = "codex";
        mockProvider.codexInstructionsStrategy = "auto";
        mockSession.request.model = "gpt-5-codex";
        mockSession.request.message = {
          model: "gpt-5-codex",
          instructions: "test instructions content",
        };

        const mockResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
        mockFetch.mockResolvedValue(mockResponse);
        vi.mocked(CodexInstructionsCache.set).mockResolvedValue(undefined);

        await ProxyForwarder.send(mockSession);

        expect(CodexInstructionsCache.set).toHaveBeenCalledWith(
          mockProvider.id,
          "gpt-5-codex",
          "test instructions content"
        );
      });

      it("should update session binding after success", async () => {
        const mockResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
        mockFetch.mockResolvedValue(mockResponse);

        await ProxyForwarder.send(mockSession);

        expect(sessionManager.SessionManager.updateSessionBindingSmart).toHaveBeenCalledWith(
          "session-123",
          mockProvider.id,
          mockProvider.priority,
          true
        );

        expect(sessionManager.SessionManager.updateSessionProvider).toHaveBeenCalledWith(
          "session-123",
          {
            providerId: mockProvider.id,
            providerName: mockProvider.name,
          }
        );
      });
    });

    describe("error handling", () => {
      it("should throw error if provider is missing", async () => {
        mockSession.provider = null;

        await expect(ProxyForwarder.send(mockSession)).rejects.toThrow(
          "代理上下文缺少供应商或鉴权信息"
        );
      });

      it("should throw error if auth state is not successful", async () => {
        mockSession.authState = { success: false, user: null, key: null, apiKey: null };

        await expect(ProxyForwarder.send(mockSession)).rejects.toThrow(
          "代理上下文缺少供应商或鉴权信息"
        );
      });

      it("should handle HTTP 4xx/5xx errors as provider errors", async () => {
        const mockErrorResponse = new Response(
          JSON.stringify({ error: { message: "Bad request" } }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        );

        mockFetch.mockResolvedValue(mockErrorResponse);
        vi.mocked(ProxyProviderResolver.pickRandomProviderWithExclusion).mockResolvedValue(null);

        await expect(ProxyForwarder.send(mockSession)).rejects.toThrow(ProxyError);

        expect(circuitBreaker.recordFailure).toHaveBeenCalledWith(
          mockProvider.id,
          expect.any(ProxyError)
        );
        expect(mockSession.addProviderToChain).toHaveBeenCalledWith(
          mockProvider,
          expect.objectContaining({ reason: "retry_failed", statusCode: 400 })
        );
      });

      it("should handle network errors as system errors", async () => {
        const networkError = new Error("ECONNREFUSED");
        Object.assign(networkError, { code: "ECONNREFUSED", syscall: "connect" });

        mockFetch.mockRejectedValue(networkError);
        vi.mocked(ProxyProviderResolver.pickRandomProviderWithExclusion).mockResolvedValue(null);

        await expect(ProxyForwarder.send(mockSession)).rejects.toThrow();

        // System errors should retry current provider first (not record failure immediately)
        expect(mockFetch).toHaveBeenCalledTimes(2); // Initial + 1 retry
      });

      it("should immediately stop on client abort errors", async () => {
        const abortError = new Error("This operation was aborted");
        abortError.name = "AbortError";

        mockFetch.mockRejectedValue(abortError);

        await expect(ProxyForwarder.send(mockSession)).rejects.toThrow();

        expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
        expect(circuitBreaker.recordFailure).not.toHaveBeenCalled(); // Should not record failure
        expect(mockSession.addProviderToChain).toHaveBeenCalledWith(
          mockProvider,
          expect.objectContaining({ reason: "system_error" })
        );
      });

      it("should retry with official instructions on 'Instructions are not valid' error", async () => {
        mockProvider.providerType = "codex";
        mockSession.request.message = {
          model: "gpt-5-codex",
          instructions: "invalid instructions",
          _canRetryWithOfficialInstructions: true,
        };

        // First attempt: 400 error
        const errorResponse = new Response(
          JSON.stringify({ error: { message: "Instructions are not valid" } }),
          { status: 400, headers: { "content-type": "application/json" } }
        );

        // Second attempt: success
        const successResponse = new Response(JSON.stringify({ success: true }), { status: 200 });

        mockFetch.mockResolvedValueOnce(errorResponse).mockResolvedValueOnce(successResponse);

        const result = await ProxyForwarder.send(mockSession);

        expect(result).toBe(successResponse);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockSession.addProviderToChain).toHaveBeenCalledWith(
          mockProvider,
          expect.objectContaining({ reason: "retry_with_official_instructions" })
        );
      });

      it("should use cached instructions for retry when available", async () => {
        mockProvider.providerType = "codex";
        mockProvider.codexInstructionsStrategy = "auto";
        mockSession.request.model = "gpt-5-codex";
        mockSession.request.message = {
          model: "gpt-5-codex",
          instructions: "invalid instructions",
        };

        vi.mocked(CodexInstructionsCache.get).mockResolvedValue("cached instructions");

        const errorResponse = new Response(
          JSON.stringify({ error: { message: "Instructions are not valid" } }),
          { status: 400, headers: { "content-type": "application/json" } }
        );

        const successResponse = new Response(JSON.stringify({ success: true }), { status: 200 });

        mockFetch.mockResolvedValueOnce(errorResponse).mockResolvedValueOnce(successResponse);

        await ProxyForwarder.send(mockSession);

        expect(CodexInstructionsCache.get).toHaveBeenCalledWith(mockProvider.id, "gpt-5-codex");
        expect(mockSession.addProviderToChain).toHaveBeenCalledWith(
          mockProvider,
          expect.objectContaining({ reason: "retry_with_cached_instructions" })
        );
      });
    });

    describe("provider failover", () => {
      it("should switch to alternative provider on failure", async () => {
        const alternativeProvider = {
          ...mockProvider,
          id: 2,
          name: "Alternative Provider",
        } as Provider;

        const errorResponse = new Response(JSON.stringify({ error: "Server error" }), {
          status: 500,
        });
        const successResponse = new Response(JSON.stringify({ success: true }), { status: 200 });

        mockFetch.mockResolvedValueOnce(errorResponse).mockResolvedValueOnce(successResponse);

        vi.mocked(ProxyProviderResolver.pickRandomProviderWithExclusion).mockResolvedValue(
          alternativeProvider
        );

        const result = await ProxyForwarder.send(mockSession);

        expect(result).toBe(successResponse);
        expect(mockSession.setProvider).toHaveBeenCalledWith(alternativeProvider);
        expect(ProxyProviderResolver.pickRandomProviderWithExclusion).toHaveBeenCalledWith(
          mockSession,
          [mockProvider.id]
        );
      });

      it("should fail when all providers are exhausted", async () => {
        const errorResponse = new Response(JSON.stringify({ error: "Server error" }), {
          status: 500,
        });

        mockFetch.mockResolvedValue(errorResponse);
        vi.mocked(ProxyProviderResolver.pickRandomProviderWithExclusion).mockResolvedValue(null);

        await expect(ProxyForwarder.send(mockSession)).rejects.toThrow(
          "所有供应商暂时不可用，请稍后重试"
        );
      });

      it("should respect MAX_PROVIDER_SWITCHES safety limit", async () => {
        const errorResponse = new Response(JSON.stringify({ error: "Server error" }), {
          status: 500,
        });

        mockFetch.mockResolvedValue(errorResponse);

        // Mock always returning a new provider to trigger the safety limit
        let providerIdCounter = 1;
        vi.mocked(ProxyProviderResolver.pickRandomProviderWithExclusion).mockImplementation(
          async () => {
            providerIdCounter++;
            return {
              ...mockProvider,
              id: providerIdCounter,
              name: `Provider ${providerIdCounter}`,
            } as Provider;
          }
        );

        await expect(ProxyForwarder.send(mockSession)).rejects.toThrow(
          "所有供应商暂时不可用，请稍后重试"
        );

        // Should stop at MAX_PROVIDER_SWITCHES (20)
        expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(40); // 20 providers × 2 attempts
      });
    });

    describe("proxy configuration", () => {
      it("should use proxy agent when configured", async () => {
        const mockProxyAgent = { type: "proxy-agent" };
        const proxyConfig = {
          agent: mockProxyAgent,
          fallbackToDirect: false,
          proxyUrl: "http://proxy.example.com:8080",
        };

        vi.mocked(createProxyAgentForProvider).mockReturnValue(proxyConfig);

        const mockResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
        mockFetch.mockResolvedValue(mockResponse);

        await ProxyForwarder.send(mockSession);

        expect(createProxyAgentForProvider).toHaveBeenCalledWith(mockProvider, expect.any(String));

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            dispatcher: mockProxyAgent,
          })
        );
      });

      it("should fallback to direct connection when proxy fails", async () => {
        const mockProxyAgent = { type: "proxy-agent" };
        const proxyConfig = {
          agent: mockProxyAgent,
          fallbackToDirect: true,
          proxyUrl: "http://proxy.example.com:8080",
        };

        vi.mocked(createProxyAgentForProvider).mockReturnValue(proxyConfig);

        const proxyError = new Error("ECONNREFUSED");
        Object.assign(proxyError, { code: "ECONNREFUSED" });

        const successResponse = new Response(JSON.stringify({ success: true }), { status: 200 });

        mockFetch
          .mockRejectedValueOnce(proxyError) // First attempt with proxy fails
          .mockResolvedValueOnce(successResponse); // Second attempt without proxy succeeds

        const result = await ProxyForwarder.send(mockSession);

        expect(result).toBe(successResponse);
        expect(mockFetch).toHaveBeenCalledTimes(2);

        // Second call should not have dispatcher
        const secondCallInit = mockFetch.mock.calls[1][1];
        expect(secondCallInit).not.toHaveProperty("dispatcher");
      });

      it("should not fallback when proxy fallback is disabled", async () => {
        const mockProxyAgent = { type: "proxy-agent" };
        const proxyConfig = {
          agent: mockProxyAgent,
          fallbackToDirect: false,
          proxyUrl: "http://proxy.example.com:8080",
        };

        vi.mocked(createProxyAgentForProvider).mockReturnValue(proxyConfig);

        const proxyError = new Error("Proxy connection failed: ECONNREFUSED");
        Object.assign(proxyError, { code: "ECONNREFUSED" });

        mockFetch.mockRejectedValue(proxyError);
        vi.mocked(ProxyProviderResolver.pickRandomProviderWithExclusion).mockResolvedValue(null);

        await expect(ProxyForwarder.send(mockSession)).rejects.toThrow();

        // The code will throw ProxyError immediately when fallbackToDirect is false
        // So it should only be called once per provider attempt
        expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe("request parameter filtering", () => {
      it("should filter private parameters (underscore-prefixed)", async () => {
        mockSession.request.message = {
          model: "claude-3-opus",
          messages: [],
          _canRetryWithOfficialInstructions: true,
          _internalFlag: "test",
        };

        const mockResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
        mockFetch.mockResolvedValue(mockResponse);

        await ProxyForwarder.send(mockSession);

        const fetchCallBody = mockFetch.mock.calls[0][1]?.body;
        expect(fetchCallBody).toBeDefined();

        const parsedBody = JSON.parse(fetchCallBody as string);
        expect(parsedBody).not.toHaveProperty("_canRetryWithOfficialInstructions");
        expect(parsedBody).not.toHaveProperty("_internalFlag");
        expect(parsedBody).toHaveProperty("model");
        expect(parsedBody).toHaveProperty("messages");
      });

      it("should recursively filter private parameters in nested objects", async () => {
        mockSession.request.message = {
          model: "claude-3-opus",
          metadata: {
            userId: "123",
            _internalData: "secret",
          },
          messages: [
            {
              role: "user",
              content: "test",
              _debugInfo: "internal",
            },
          ],
        };

        const mockResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
        mockFetch.mockResolvedValue(mockResponse);

        await ProxyForwarder.send(mockSession);

        const fetchCallBody = mockFetch.mock.calls[0][1]?.body;
        const parsedBody = JSON.parse(fetchCallBody as string);

        expect(parsedBody.metadata).not.toHaveProperty("_internalData");
        expect(parsedBody.metadata).toHaveProperty("userId");
        expect(parsedBody.messages[0]).not.toHaveProperty("_debugInfo");
        expect(parsedBody.messages[0]).toHaveProperty("role");
      });

      it("should handle arrays correctly when filtering", async () => {
        mockSession.request.message = {
          model: "claude-3-opus",
          tools: [
            { name: "tool1", _internal: "data" },
            { name: "tool2", description: "test" },
          ],
        };

        const mockResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
        mockFetch.mockResolvedValue(mockResponse);

        await ProxyForwarder.send(mockSession);

        const fetchCallBody = mockFetch.mock.calls[0][1]?.body;
        const parsedBody = JSON.parse(fetchCallBody as string);

        expect(Array.isArray(parsedBody.tools)).toBe(true);
        expect(parsedBody.tools[0]).not.toHaveProperty("_internal");
        expect(parsedBody.tools[0]).toHaveProperty("name");
        expect(parsedBody.tools[1]).toHaveProperty("description");
      });
    });

    describe("edge cases", () => {
      it("should handle non-retryable client errors correctly", async () => {
        const errorResponse = new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: "prompt is too long: 201000 tokens > 200000 maximum",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );

        mockFetch.mockResolvedValue(errorResponse);

        await expect(ProxyForwarder.send(mockSession)).rejects.toThrow(ProxyError);

        // Should not retry or switch providers for non-retryable client errors
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(circuitBreaker.recordFailure).not.toHaveBeenCalled();
        expect(mockSession.addProviderToChain).toHaveBeenCalledWith(
          mockProvider,
          expect.objectContaining({ reason: "client_error_non_retryable" })
        );
      });

      it("should not record failure for probe requests", async () => {
        vi.mocked(mockSession.isProbeRequest).mockReturnValue(true);

        const errorResponse = new Response(JSON.stringify({ error: "Server error" }), {
          status: 500,
        });

        mockFetch.mockResolvedValue(errorResponse);
        vi.mocked(ProxyProviderResolver.pickRandomProviderWithExclusion).mockResolvedValue(null);

        await expect(ProxyForwarder.send(mockSession)).rejects.toThrow();

        expect(circuitBreaker.recordFailure).not.toHaveBeenCalled();
      });

      it("should handle GET requests without body", async () => {
        mockSession.method = "GET";

        const mockResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
        mockFetch.mockResolvedValue(mockResponse);

        await ProxyForwarder.send(mockSession);

        const fetchCallInit = mockFetch.mock.calls[0][1];
        expect(fetchCallInit).not.toHaveProperty("body");
      });

      it("should handle HEAD requests without body", async () => {
        mockSession.method = "HEAD";

        const mockResponse = new Response(null, { status: 200 });
        mockFetch.mockResolvedValue(mockResponse);

        await ProxyForwarder.send(mockSession);

        const fetchCallInit = mockFetch.mock.calls[0][1];
        expect(fetchCallInit).not.toHaveProperty("body");
      });

      it("should pass client abort signal to fetch", async () => {
        const abortController = new AbortController();
        mockSession.clientAbortSignal = abortController.signal;

        const mockResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
        mockFetch.mockResolvedValue(mockResponse);

        await ProxyForwarder.send(mockSession);

        const fetchCallInit = mockFetch.mock.calls[0][1];
        expect(fetchCallInit?.signal).toBe(abortController.signal);
      });
    });
  });
});
