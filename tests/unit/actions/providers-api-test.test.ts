import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
const executeProviderTestMock = vi.fn();
const getPresetsForProviderMock = vi.fn();
const validateProviderUrlForConnectivityMock = vi.fn();
const createProxyAgentForProviderMock = vi.fn();
const getAccessTokenMock = vi.fn();
const isJsonMock = vi.fn();
const isOpenAIResponsesWebSocketEnabledMock = vi.fn();
const createDefaultResponsesWebSocketProbeMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  createProvider: vi.fn(),
  deleteProvider: vi.fn(),
  findAllProviders: vi.fn(async () => []),
  findAllProvidersFresh: vi.fn(async () => []),
  findProviderById: vi.fn(),
  getProviderStatistics: vi.fn(),
  resetProviderTotalCostResetAt: vi.fn(async () => {}),
  updateProvider: vi.fn(),
  updateProviderPrioritiesBatch: vi.fn(),
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: vi.fn(),
}));

vi.mock("@/lib/redis/circuit-breaker-config", () => ({
  deleteProviderCircuitConfig: vi.fn(),
  saveProviderCircuitConfig: vi.fn(),
}));

vi.mock("@/lib/circuit-breaker", () => ({
  clearConfigCache: vi.fn(),
  clearProviderState: vi.fn(),
  getAllHealthStatusAsync: vi.fn(async () => ({})),
  publishCircuitBreakerConfigInvalidation: vi.fn(),
  forceCloseCircuitState: vi.fn(),
  resetCircuit: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    terminateProviderSessionsBatch: vi.fn(),
    terminateStickySessionsForProviders: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/provider-testing", () => ({
  createDefaultResponsesWebSocketProbe: createDefaultResponsesWebSocketProbeMock,
  executeProviderTest: executeProviderTestMock,
}));

vi.mock("@/lib/config", () => ({
  isOpenAIResponsesWebSocketEnabled: isOpenAIResponsesWebSocketEnabledMock,
}));

vi.mock("@/lib/provider-testing/presets", () => ({
  getPresetsForProvider: getPresetsForProviderMock,
}));

vi.mock("@/lib/validation/provider-url", () => ({
  validateProviderUrlForConnectivity: validateProviderUrlForConnectivityMock,
}));

vi.mock("@/lib/proxy-agent", () => ({
  createProxyAgentForProvider: createProxyAgentForProviderMock,
  isValidProxyUrl: vi.fn(() => true),
}));

vi.mock("@/app/v1/_lib/gemini/auth", () => ({
  GeminiAuth: {
    getAccessToken: getAccessTokenMock,
    isJson: isJsonMock,
  },
}));

const fetchMock = vi.fn<typeof fetch>();

describe("providers api test actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    validateProviderUrlForConnectivityMock.mockImplementation((providerUrl: string) => ({
      valid: true,
      normalizedUrl: providerUrl,
    }));
    createProxyAgentForProviderMock.mockReturnValue(null);
    getAccessTokenMock.mockImplementation(async (apiKey: string) => apiKey);
    isJsonMock.mockReturnValue(false);
    getPresetsForProviderMock.mockReturnValue([]);
    isOpenAIResponsesWebSocketEnabledMock.mockResolvedValue(false);
    global.fetch = fetchMock as typeof fetch;
  });

  test("testProviderUnified should forward request url and rawResponse on failure", async () => {
    executeProviderTestMock.mockResolvedValue({
      success: false,
      status: "red",
      subStatus: "invalid_request",
      message: "invalid request",
      latencyMs: 123,
      firstByteMs: 45,
      httpStatusCode: 400,
      httpStatusText: "Bad Request",
      model: "gpt-4.1-mini",
      content: undefined,
      requestUrl: "https://api.gptclubapi.xyz/openai/responses",
      rawResponse: '{"error":"Invalid URL (POST /v1/v1/responses)"}',
      usage: undefined,
      streamInfo: undefined,
      errorMessage: "Invalid URL (POST /v1/v1/responses)",
      errorType: "invalid_request_error",
      testedAt: new Date("2026-04-08T00:00:00.000Z"),
      validationDetails: {
        httpPassed: false,
        httpStatusCode: 400,
        latencyPassed: true,
        latencyMs: 123,
        contentPassed: false,
        contentTarget: "pong",
      },
    });

    const { testProviderUnified } = await import("@/actions/providers");
    const result = await testProviderUnified({
      providerUrl: "https://api.example.com",
      apiKey: "sk-test",
      providerType: "openai-compatible",
      model: "gpt-4.1-mini",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.success).toBe(false);
    const forwarded = result.data as { requestUrl?: string; rawResponse?: string } | undefined;
    expect(forwarded?.requestUrl).toBe("https://api.gptclubapi.xyz/openai/responses");
    expect(forwarded?.rawResponse).toBe('{"error":"Invalid URL (POST /v1/v1/responses)"}');
  });

  test("testProviderUnified wires the default Responses WebSocket probe for enabled Codex providers", async () => {
    const defaultProbe = vi.fn();
    isOpenAIResponsesWebSocketEnabledMock.mockResolvedValue(true);
    createDefaultResponsesWebSocketProbeMock.mockReturnValue(defaultProbe);
    executeProviderTestMock.mockResolvedValue(
      createUnifiedProviderTestResult({
        compatibility: {
          responsesWebSocket: {
            status: "supported",
            supported: true,
            degraded: false,
          },
        },
      })
    );

    const { testProviderUnified } = await import("@/actions/providers");
    const result = await testProviderUnified({
      providerUrl: "https://codex.example.com/v1",
      apiKey: "sk-test",
      providerType: "codex",
      model: "gpt-5.3-codex",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.success).toBe(true);
    expect(result.data?.status).toBe("green");
    expect(result.data?.subStatus).toBe("success");
    expect(result.data?.httpStatusCode).toBe(200);
    expect(result.data?.compatibility?.responsesWebSocket).toEqual({
      status: "supported",
      supported: true,
      degraded: false,
    });
    expect(createDefaultResponsesWebSocketProbeMock).toHaveBeenCalledTimes(1);
    expect(executeProviderTestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: "codex",
        responsesWebSocketProbe: defaultProbe,
      })
    );
  });

  test("testProviderUnified does not wire a Responses WebSocket probe when the setting is disabled", async () => {
    isOpenAIResponsesWebSocketEnabledMock.mockResolvedValue(false);
    executeProviderTestMock.mockResolvedValue(createUnifiedProviderTestResult());

    const { testProviderUnified } = await import("@/actions/providers");
    const result = await testProviderUnified({
      providerUrl: "https://codex.example.com/v1",
      apiKey: "sk-test",
      providerType: "codex",
      model: "gpt-5.3-codex",
    });

    expect(result.ok).toBe(true);
    expect(createDefaultResponsesWebSocketProbeMock).not.toHaveBeenCalled();
    expect(executeProviderTestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: "codex",
        responsesWebSocketProbe: undefined,
      })
    );
  });

  test("testProviderUnified never wires a Responses WebSocket probe for non-Codex providers", async () => {
    isOpenAIResponsesWebSocketEnabledMock.mockResolvedValue(true);
    executeProviderTestMock.mockResolvedValue(createUnifiedProviderTestResult());

    const { testProviderUnified } = await import("@/actions/providers");
    const result = await testProviderUnified({
      providerUrl: "https://openai-compatible.example.com/v1",
      apiKey: "sk-test",
      providerType: "openai-compatible",
      model: "gpt-4.1-mini",
    });

    expect(result.ok).toBe(true);
    expect(createDefaultResponsesWebSocketProbeMock).not.toHaveBeenCalled();
    expect(executeProviderTestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: "openai-compatible",
        responsesWebSocketProbe: undefined,
      })
    );
  });

  test("testProviderGemini 成功时也应该返回完整响应体，保证前端能展示原始 body", async () => {
    const responseBody = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: "pong" }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 2,
        candidatesTokenCount: 1,
        totalTokenCount: 3,
      },
    });

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "application/json",
      }),
      text: async () => responseBody,
    } as Response);

    const { testProviderGemini } = await import("@/actions/providers");
    const result = await testProviderGemini({
      providerUrl: "https://gemini.example.com",
      apiKey: "AIza1234567890abcdefghijklmnopqrstuvwxyz",
      model: "gemini-2.5-pro",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.success).toBe(true);
    const details = result.data && "details" in result.data ? result.data.details : undefined;
    expect((details as { rawResponse?: string } | undefined)?.rawResponse).toBe(responseBody);
  });
});

function createUnifiedProviderTestResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    status: "green",
    subStatus: "success",
    latencyMs: 123,
    firstByteMs: 45,
    httpStatusCode: 200,
    httpStatusText: "OK",
    model: "gpt-5.3-codex",
    content: "pong",
    requestUrl: "https://codex.example.com/v1/responses",
    rawResponse: '{"output":[{"content":[{"text":"pong"}]}]}',
    testedAt: new Date("2026-04-08T00:00:00.000Z"),
    validationDetails: {
      httpPassed: true,
      httpStatusCode: 200,
      latencyPassed: true,
      latencyMs: 123,
      contentPassed: true,
      contentTarget: "pong",
    },
    ...overrides,
  };
}
