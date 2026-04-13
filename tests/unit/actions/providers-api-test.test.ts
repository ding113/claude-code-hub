import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
const executeProviderTestMock = vi.fn();
const getPresetsForProviderMock = vi.fn();
const validateProviderUrlForConnectivityMock = vi.fn();
const createProxyAgentForProviderMock = vi.fn();
const getAccessTokenMock = vi.fn();
const isJsonMock = vi.fn();

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
  executeProviderTest: executeProviderTestMock,
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
    global.fetch = fetchMock as typeof fetch;
  });

  test("testProviderUnified 应该把 executeProviderTest 返回的完整 rawResponse 透传给前端", async () => {
    executeProviderTestMock.mockResolvedValue({
      success: true,
      status: "green",
      subStatus: "success",
      message: "ok",
      latencyMs: 123,
      firstByteMs: 45,
      httpStatusCode: 200,
      httpStatusText: "OK",
      model: "gpt-4.1-mini",
      content: "pong",
      rawResponse: '{"message":"pong"}',
      usage: undefined,
      streamInfo: undefined,
      errorMessage: undefined,
      errorType: undefined,
      testedAt: new Date("2026-04-08T00:00:00.000Z"),
      validationDetails: {
        httpPassed: true,
        latencyPassed: true,
        contentPassed: true,
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
    expect(result.data?.success).toBe(true);
    expect((result.data as { rawResponse?: string } | undefined)?.rawResponse).toBe(
      '{"message":"pong"}'
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
