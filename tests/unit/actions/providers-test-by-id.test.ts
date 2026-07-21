import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

const getSessionMock = vi.fn();
const findProviderByIdMock = vi.fn();
const validateProviderUrlForConnectivityMock = vi.fn();
const runProviderHealthTestMock = vi.fn();
const getDefaultHealthTestModelMock = vi.fn((type: string) => {
  if (type === "claude" || type === "claude-auth") return "claude-opus-4-6";
  if (type === "codex") return "gpt-5.6-terra";
  if (type === "openai-compatible") return "grok-4.5";
  return "gemini-2.5-flash";
});

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

vi.mock("@/lib/validation/provider-url", () => ({
  validateProviderUrlForConnectivity: validateProviderUrlForConnectivityMock,
}));

vi.mock("@/lib/provider-health-test/run-test", () => ({
  runProviderHealthTest: runProviderHealthTestMock,
}));

vi.mock("@/lib/provider-health-test/defaults", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/provider-health-test/defaults")>();
  return {
    ...actual,
    getDefaultHealthTestModel: getDefaultHealthTestModelMock,
  };
});

function buildProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 7,
    name: "p-claude",
    url: "https://api.example.com",
    key: "sk-test-secret",
    providerType: "claude",
    proxyUrl: null,
    proxyFallbackToDirect: false,
    customHeaders: null,
    ...overrides,
  } as Provider;
}

const GREEN_RESULT = {
  success: true,
  status: "green" as const,
  subStatus: "success" as const,
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
      safe: true,
      normalizedUrl: providerUrl,
    }));
    findProviderByIdMock.mockResolvedValue(buildProvider());
    runProviderHealthTestMock.mockResolvedValue(GREEN_RESULT);
    getDefaultHealthTestModelMock.mockImplementation((type: string) => {
      if (type === "claude" || type === "claude-auth") return "claude-opus-4-6";
      if (type === "codex") return "gpt-5.6-terra";
      if (type === "openai-compatible") return "grok-4.5";
      return "gemini-2.5-flash";
    });
  });

  test("非 admin 会话应返回未授权且不执行测试", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 2, role: "user" } });

    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(7);

    expect(result.ok).toBe(false);
    expect(runProviderHealthTestMock).not.toHaveBeenCalled();
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
    expect(runProviderHealthTestMock).not.toHaveBeenCalled();
  });

  test("URL 校验失败时不执行测试", async () => {
    validateProviderUrlForConnectivityMock.mockReturnValue({
      valid: false,
      safe: false,
      reason: "blocked url",
      error: { message: "blocked url" },
    });

    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(7);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("blocked url");
    }
    expect(runProviderHealthTestMock).not.toHaveBeenCalled();
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
    expect(runProviderHealthTestMock).toHaveBeenCalledTimes(1);
    const input = runProviderHealthTestMock.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      source: "manual",
      model: "claude-sonnet-4-5",
      provider: {
        id: 7,
        url: "https://api.example.com",
        key: "sk-test-secret",
        providerType: "claude",
        proxyUrl: "http://proxy.local:8080",
        proxyFallbackToDirect: true,
        customHeaders: { "x-extra": "1" },
      },
    });
    if (result.ok) {
      expect(result.data?.status).toBe("green");
      expect(result.data?.testedAt).toBe("2026-06-12T00:00:00.000Z");
    }
  });

  test("空白 model 覆盖会回退到类型默认模型", async () => {
    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(7, { model: "   " });

    expect(result.ok).toBe(true);
    const input = runProviderHealthTestMock.mock.calls[0]?.[0];
    expect(input?.model).toBe("claude-opus-4-6");
  });

  test("手动测试不设置 15s 首字超时，走 runProviderHealthTest", async () => {
    const { testProviderById } = await import("@/actions/providers");
    await testProviderById(7);

    expect(runProviderHealthTestMock).toHaveBeenCalledTimes(1);
    const input = runProviderHealthTestMock.mock.calls[0]?.[0];
    expect(input?.source).toBe("manual");
    // firstByteTimeout is decided inside runProviderHealthTest (undefined now)
  });

  test("runProviderHealthTest 抛错时返回失败结果", async () => {
    runProviderHealthTestMock.mockRejectedValue(new Error("upstream exploded"));

    const { testProviderById } = await import("@/actions/providers");
    const result = await testProviderById(7);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("upstream exploded");
    }
  });
});
