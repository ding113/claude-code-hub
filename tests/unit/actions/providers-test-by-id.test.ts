import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

const getSessionMock = vi.fn();
const executeProviderTestMock = vi.fn();
const findProviderByIdMock = vi.fn();
const getPresetsForProviderMock = vi.fn();
const validateProviderUrlForConnectivityMock = vi.fn();
const createProxyAgentForProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  createProvider: vi.fn(),
  deleteProvider: vi.fn(),
  findAllProviders: vi.fn(async () => []),
  findAllProvidersFresh: vi.fn(async () => []),
  findProviderById: findProviderByIdMock,
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

const geminiGetAccessTokenMock = vi.fn(async (apiKey: string) => apiKey);
const geminiIsJsonMock = vi.fn(() => false);

vi.mock("@/app/v1/_lib/gemini/auth", () => ({
  GeminiAuth: {
    getAccessToken: geminiGetAccessTokenMock,
    isJson: geminiIsJsonMock,
  },
}));

function buildProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 7,
    name: "p-claude",
    url: "https://api.example.com",
    key: "sk-stored-secret",
    providerType: "claude",
    proxyUrl: null,
    proxyFallbackToDirect: false,
    customHeaders: null,
    ...overrides,
  } as Provider;
}

const GREEN_RESULT = {
  success: true,
  status: "green",
  subStatus: "success",
  latencyMs: 88,
  firstByteMs: 30,
  httpStatusCode: 200,
  httpStatusText: "OK",
  model: "claude-sonnet-4-5",
  content: "pong",
  rawResponse: '{"content":"pong"}',
  requestUrl: "https://api.example.com/v1/messages",
  testedAt: new Date("2026-06-12T00:00:00.000Z"),
  validationDetails: {
    httpPassed: true,
    httpStatusCode: 200,
    latencyPassed: true,
    latencyMs: 88,
    contentPassed: true,
    contentTarget: "pong",
  },
};

describe("testProviderById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    validateProviderUrlForConnectivityMock.mockImplementation((providerUrl: string) => ({
      valid: true,
      normalizedUrl: providerUrl,
    }));
    createProxyAgentForProviderMock.mockReturnValue(null);
    getPresetsForProviderMock.mockReturnValue([]);
    findProviderByIdMock.mockResolvedValue(buildProvider());
    executeProviderTestMock.mockResolvedValue(GREEN_RESULT);
    geminiGetAccessTokenMock.mockImplementation(async (apiKey: string) => apiKey);
    geminiIsJsonMock.mockReturnValue(false);
  });

  test("非 admin 会话应返回未授权且不执行测试", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 2, role: "user" } });

    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(7);

    expect(result.ok).toBe(false);
    expect(executeProviderTestMock).not.toHaveBeenCalled();
    expect(findProviderByIdMock).not.toHaveBeenCalled();
  });

  test("供应商不存在时返回 provider.not_found", async () => {
    findProviderByIdMock.mockResolvedValue(null);

    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(404);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("provider.not_found");
    }
    expect(executeProviderTestMock).not.toHaveBeenCalled();
  });

  test("URL 校验失败时不执行测试", async () => {
    validateProviderUrlForConnectivityMock.mockReturnValue({
      valid: false,
      error: { message: "blocked url" },
    });

    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(7);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("blocked url");
    }
    expect(executeProviderTestMock).not.toHaveBeenCalled();
  });

  test("使用库内配置执行测试，密钥来自数据库", async () => {
    findProviderByIdMock.mockResolvedValue(
      buildProvider({
        proxyUrl: "http://proxy.local:8080",
        proxyFallbackToDirect: true,
        customHeaders: { "x-extra": "1" },
      })
    );

    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(7, { model: " claude-sonnet-4-5 " });

    expect(result.ok).toBe(true);
    expect(executeProviderTestMock).toHaveBeenCalledTimes(1);
    const config = executeProviderTestMock.mock.calls[0]?.[0];
    expect(config).toMatchObject({
      providerId: "7",
      providerUrl: "https://api.example.com",
      apiKey: "sk-stored-secret",
      providerType: "claude",
      model: "claude-sonnet-4-5",
      proxyUrl: "http://proxy.local:8080",
      proxyFallbackToDirect: true,
      customHeaders: { "x-extra": "1" },
      timeoutMs: 15000,
    });
    if (result.ok) {
      expect(result.data?.status).toBe("green");
      expect(result.data?.testedAt).toBe("2026-06-12T00:00:00.000Z");
    }
  });

  test("空白 model 覆盖会被忽略并回退到类型默认", async () => {
    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(7, { model: "   " });

    expect(result.ok).toBe(true);
    const config = executeProviderTestMock.mock.calls[0]?.[0];
    expect(config?.model).toBeUndefined();
  });

  test("gemini 类型使用 60 秒超时", async () => {
    findProviderByIdMock.mockResolvedValue(buildProvider({ providerType: "gemini" }));

    const { testProviderById } = await import("@/actions/providers");
    await testProviderById(7);

    const config = executeProviderTestMock.mock.calls[0]?.[0];
    expect(config?.timeoutMs).toBe(60000);
  });

  test("gemini JSON 凭证转换为 access token 并使用 Bearer 认证", async () => {
    const jsonKey = JSON.stringify({ type: "authorized_user", access_token: "ya29.token" });
    findProviderByIdMock.mockResolvedValue(
      buildProvider({ providerType: "gemini-cli", key: jsonKey })
    );
    geminiGetAccessTokenMock.mockResolvedValue("ya29.token");
    geminiIsJsonMock.mockReturnValue(true);

    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(7);

    expect(result.ok).toBe(true);
    expect(geminiGetAccessTokenMock).toHaveBeenCalledWith(jsonKey);
    const config = executeProviderTestMock.mock.calls[0]?.[0];
    expect(config?.apiKey).toBe("ya29.token");
    expect(config?.geminiBearerAuth).toBe(true);
  });

  test("非 gemini 类型不做凭证预处理", async () => {
    const { testProviderById } = await import("@/actions/providers");
    await testProviderById(7);

    expect(geminiGetAccessTokenMock).not.toHaveBeenCalled();
    const config = executeProviderTestMock.mock.calls[0]?.[0];
    expect(config?.apiKey).toBe("sk-stored-secret");
    expect(config?.geminiBearerAuth).toBeUndefined();
  });

  test("executeProviderTest 抛错时返回失败结果", async () => {
    executeProviderTestMock.mockRejectedValue(new Error("upstream exploded"));

    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(7);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("upstream exploded");
    }
  });
});
