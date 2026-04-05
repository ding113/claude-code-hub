import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider, ProviderAllowedModelRule } from "@/types/provider";

// 测试辅助：将模型名称字符串数组转换为 exact 匹配规则
function toExactRules(models: string[]): ProviderAllowedModelRule[] {
  return models.map((m) => ({ matchType: "exact" as const, pattern: m }));
}

// ── Mocks (shared by findReusable and pickRandomProvider tests) ──

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);

const vendorTypeCircuitMocks = vi.hoisted(() => ({
  isVendorTypeCircuitOpen: vi.fn(async () => false),
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => vendorTypeCircuitMocks);

const sessionManagerMocks = vi.hoisted(() => ({
  SessionManager: {
    getSessionProvider: vi.fn(async () => null as number | null),
    clearSessionProvider: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/session-manager", () => sessionManagerMocks);

const providerRepositoryMocks = vi.hoisted(() => ({
  findProviderById: vi.fn(async () => null as Provider | null),
  findAllProviders: vi.fn(async () => [] as Provider[]),
}));

vi.mock("@/repository/provider", () => providerRepositoryMocks);

const rateLimitMocks = vi.hoisted(() => ({
  RateLimitService: {
    checkCostLimitsWithLease: vi.fn(async () => ({ allowed: true })),
    checkTotalCostLimit: vi.fn(async () => ({ allowed: true, current: 0 })),
  },
}));

vi.mock("@/lib/rate-limit", () => rateLimitMocks);

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Helpers ──

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "test-provider",
    isEnabled: true,
    providerType: "openai-compatible",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    allowedModels: null,
    providerVendorId: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
    ...overrides,
  } as unknown as Provider;
}

// ══════════════════════════════════════════════════════════════════
// Part 1: Direct unit tests for providerSupportsModel (table-driven)
// ══════════════════════════════════════════════════════════════════

describe("providerSupportsModel - direct unit tests (#832)", () => {
  const cases: Array<{
    name: string;
    providerType: string;
    allowedModels: ProviderAllowedModelRule[] | null;
    modelRedirects?: Record<string, string>;
    requestedModel: string;
    expected: boolean;
  }> = [
    // Core fix: openai-compatible + claude model + explicit allowedModels
    {
      name: "openai-compatible + allowedModels contains claude model -> true",
      providerType: "openai-compatible",
      allowedModels: toExactRules(["claude-opus-4-6"]),
      requestedModel: "claude-opus-4-6",
      expected: true,
    },
    {
      name: "openai-compatible + null allowedModels + claude model -> true (wildcard)",
      providerType: "openai-compatible",
      allowedModels: null,
      requestedModel: "claude-sonnet-4-5-20250929",
      expected: true,
    },
    {
      name: "openai-compatible + empty allowedModels + claude model -> true (wildcard)",
      providerType: "openai-compatible",
      allowedModels: [],
      requestedModel: "claude-opus-4-6",
      expected: true,
    },
    {
      name: "openai-compatible + allowedModels NOT containing model -> false",
      providerType: "openai-compatible",
      allowedModels: toExactRules(["gpt-4o", "gpt-4o-mini"]),
      requestedModel: "claude-opus-4-6",
      expected: false,
    },

    // Claude provider behavior
    {
      name: "claude + null allowedModels + claude model -> true (wildcard)",
      providerType: "claude",
      allowedModels: null,
      requestedModel: "claude-opus-4-6",
      expected: true,
    },
    {
      name: "claude + null allowedModels + non-claude model -> true (wildcard)",
      providerType: "claude",
      allowedModels: null,
      requestedModel: "gpt-4o",
      expected: true,
    },
    {
      name: "claude + allowedModels contains non-claude model -> true (explicit)",
      providerType: "claude",
      allowedModels: toExactRules(["gemini-2.5-pro"]),
      requestedModel: "gemini-2.5-pro",
      expected: true,
    },
    {
      name: "claude + allowedModels NOT containing model -> false",
      providerType: "claude",
      allowedModels: toExactRules(["claude-haiku-4-5"]),
      requestedModel: "claude-opus-4-6",
      expected: false,
    },
    {
      name: "claude-auth + null allowedModels -> true (wildcard)",
      providerType: "claude-auth",
      allowedModels: null,
      requestedModel: "claude-opus-4-6",
      expected: true,
    },

    // modelRedirects
    {
      name: "modelRedirects + null allowedModels -> true (wildcard)",
      providerType: "openai-compatible",
      allowedModels: null,
      modelRedirects: { "claude-opus-4-6": "custom-opus" },
      requestedModel: "claude-opus-4-6",
      expected: true,
    },
    {
      name: "modelRedirects does not bypass explicit allowedModels mismatch -> false",
      providerType: "claude",
      allowedModels: toExactRules(["claude-haiku-4-5-20251001", "glm-4.6"]),
      modelRedirects: {
        "claude-haiku-4-5-20251001": "glm-4.6",
        "claude-opus-4-5-20251001": "glm-4.6",
      },
      requestedModel: "claude-opus-4-5-20251001",
      expected: false,
    },
    {
      name: "neither allowedModels nor modelRedirects contains model -> false",
      providerType: "openai-compatible",
      allowedModels: toExactRules(["gpt-4o"]),
      modelRedirects: { "gpt-4": "gpt-4o" },
      requestedModel: "claude-opus-4-6",
      expected: false,
    },

    // Other provider types
    {
      name: "codex + null allowedModels -> true (wildcard)",
      providerType: "codex",
      allowedModels: null,
      requestedModel: "codex-mini-latest",
      expected: true,
    },
    {
      name: "gemini + allowedModels match -> true",
      providerType: "gemini",
      allowedModels: toExactRules(["gemini-2.0-flash"]),
      requestedModel: "gemini-2.0-flash",
      expected: true,
    },
  ];

  test.each(cases)("$name", async ({
    providerType,
    allowedModels,
    modelRedirects,
    requestedModel,
    expected,
  }) => {
    const { providerSupportsModel } = await import("@/app/v1/_lib/proxy/provider-selector");
    const provider = createProvider({
      providerType,
      allowedModels,
      ...(modelRedirects && { modelRedirects }),
    });
    expect(providerSupportsModel(provider, requestedModel)).toBe(expected);
  });
});

// ══════════════════════════════════════════════════════════════════
// Part 2: Integration tests via findReusable (session reuse path)
// ══════════════════════════════════════════════════════════════════

describe("findReusable - cross-type model routing (#832)", () => {
  test("openai-compatible + allowedModels with claude model -> reuse succeeds", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider = createProvider({
      id: 10,
      providerType: "openai-compatible",
      allowedModels: toExactRules(["claude-opus-4-6"]),
    });

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(10);
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce(provider);
    rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValueOnce({
      allowed: true,
    });
    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValueOnce({
      allowed: true,
      current: 0,
    });

    const session = {
      sessionId: "cross-type-1",
      shouldReuseProvider: () => true,
      getOriginalModel: () => "claude-opus-4-6",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(10);
  });

  test("openai-compatible + null allowedModels + claude model -> reuse succeeds (wildcard)", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider = createProvider({ id: 11, allowedModels: null });

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(11);
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce(provider);
    rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValueOnce({
      allowed: true,
    });
    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValueOnce({
      allowed: true,
      current: 0,
    });

    const session = {
      sessionId: "cross-type-2",
      shouldReuseProvider: () => true,
      getOriginalModel: () => "claude-sonnet-4-5-20250929",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(11);
  });

  test("openai-compatible + allowedModels mismatch -> clears stale binding", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider = createProvider({
      id: 12,
      allowedModels: toExactRules(["gpt-4o", "gpt-4o-mini"]),
    });

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(12);
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce(provider);

    const session = {
      sessionId: "cross-type-3",
      shouldReuseProvider: () => true,
      getOriginalModel: () => "claude-opus-4-6",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      "cross-type-3"
    );
  });

  test("modelRedirects do not bypass explicit allowedModels during reuse", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider = createProvider({
      id: 15,
      providerType: "claude",
      allowedModels: toExactRules(["claude-haiku-4-5-20251001", "glm-4.6"]),
      modelRedirects: {
        "claude-haiku-4-5-20251001": "glm-4.6",
        "claude-opus-4-5-20251001": "glm-4.6",
      },
    });

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(15);
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce(provider);

    const session = {
      sessionId: "cross-type-6",
      shouldReuseProvider: () => true,
      getOriginalModel: () => "claude-opus-4-5-20251001",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      "cross-type-6"
    );
  });
});

// ══════════════════════════════════════════════════════════════════
// Part 3: Integration tests via pickRandomProvider (fresh selection path)
// ══════════════════════════════════════════════════════════════════

describe("pickRandomProvider - cross-type model routing (#832)", () => {
  function createPickSession(originalFormat: string, providers: Provider[], originalModel: string) {
    return {
      originalFormat,
      authState: null,
      getProvidersSnapshot: async () => providers,
      getOriginalModel: () => originalModel,
      getCurrentModel: () => originalModel,
      clientRequestsContext1m: () => false,
    } as any;
  }

  async function setupResolverMocks() {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    vi.spyOn(ProxyProviderResolver as any, "filterByLimits").mockImplementation(
      async (...args: unknown[]) => args[0] as Provider[]
    );
    vi.spyOn(ProxyProviderResolver as any, "selectTopPriority").mockImplementation(
      (...args: unknown[]) => args[0] as Provider[]
    );
    vi.spyOn(ProxyProviderResolver as any, "selectOptimal").mockImplementation(
      (...args: unknown[]) => (args[0] as Provider[])[0] ?? null
    );

    return ProxyProviderResolver;
  }

  test("openai format + openai-compatible with allowedModels=[claude-opus-4-6] -> selected", async () => {
    const Resolver = await setupResolverMocks();

    const provider = createProvider({
      id: 20,
      providerType: "openai-compatible",
      allowedModels: toExactRules(["claude-opus-4-6"]),
    });
    const session = createPickSession("openai", [provider], "claude-opus-4-6");

    const { provider: picked } = await (Resolver as any).pickRandomProvider(session, []);

    expect(picked).not.toBeNull();
    expect(picked?.id).toBe(20);
  });

  test("openai format + claude provider with null allowedModels -> rejected by format check", async () => {
    const Resolver = await setupResolverMocks();

    const claudeProvider = createProvider({
      id: 21,
      providerType: "claude",
      allowedModels: null,
    });
    const session = createPickSession("openai", [claudeProvider], "gpt-4o");

    const { provider: picked, context } = await (Resolver as any).pickRandomProvider(session, []);

    expect(picked).toBeNull();
    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 21 && fp.reason === "format_type_mismatch"
    );
    expect(mismatch).toBeDefined();
  });

  test("openai format + openai-compatible with non-matching allowedModels -> rejected by model check", async () => {
    const Resolver = await setupResolverMocks();

    const provider = createProvider({
      id: 22,
      providerType: "openai-compatible",
      allowedModels: toExactRules(["gpt-4o"]),
    });
    const session = createPickSession("openai", [provider], "claude-opus-4-6");

    const { provider: picked, context } = await (Resolver as any).pickRandomProvider(session, []);

    expect(picked).toBeNull();
    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 22 && fp.reason === "model_not_allowed"
    );
    expect(mismatch).toBeDefined();
  });

  test("format check + model check combined: only format-and-model compatible provider selected", async () => {
    const Resolver = await setupResolverMocks();

    // claude provider (format-incompatible with openai request)
    const p1 = createProvider({
      id: 30,
      providerType: "claude",
      allowedModels: toExactRules(["claude-opus-4-6"]),
    });
    // openai-compatible but wrong model
    const p2 = createProvider({
      id: 31,
      providerType: "openai-compatible",
      allowedModels: toExactRules(["gpt-4o"]),
    });
    // openai-compatible with correct model
    const p3 = createProvider({
      id: 32,
      providerType: "openai-compatible",
      allowedModels: toExactRules(["claude-opus-4-6"]),
    });

    const session = createPickSession("openai", [p1, p2, p3], "claude-opus-4-6");

    const { provider: picked, context } = await (Resolver as any).pickRandomProvider(session, []);

    expect(picked?.id).toBe(32);

    const formatMismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 30 && fp.reason === "format_type_mismatch"
    );
    expect(formatMismatch).toBeDefined();

    const modelMismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 31 && fp.reason === "model_not_allowed"
    );
    expect(modelMismatch).toBeDefined();
  });

  test("claude format + explicit allowlist rejects opus request even when redirect points to allowed glm", async () => {
    const Resolver = await setupResolverMocks();

    const provider = createProvider({
      id: 33,
      providerType: "claude",
      allowedModels: toExactRules(["claude-haiku-4-5-20251001", "glm-4.6"]),
      modelRedirects: {
        "claude-haiku-4-5-20251001": "glm-4.6",
        "claude-opus-4-5-20251001": "glm-4.6",
      },
    });
    const session = createPickSession("claude", [provider], "claude-opus-4-5-20251001");

    const { provider: picked, context } = await (Resolver as any).pickRandomProvider(session, []);

    expect(picked).toBeNull();
    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 33 && fp.reason === "model_not_allowed"
    );
    expect(mismatch).toBeDefined();
  });

  test("claude format skips priority-0 redirect-only provider and selects lower-priority allowed provider", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    vi.spyOn(ProxyProviderResolver as any, "filterByLimits").mockImplementation(
      async (...args: unknown[]) => args[0] as Provider[]
    );

    const priorityZeroProvider = createProvider({
      id: 40,
      providerType: "claude",
      priority: 0,
      allowedModels: toExactRules(["claude-haiku-4-5-20251001", "glm-4.6"]),
      modelRedirects: {
        "claude-haiku-4-5-20251001": "glm-4.6",
        "claude-opus-4-5-20251001": "glm-4.6",
      },
    });
    const fallbackProvider = createProvider({
      id: 41,
      providerType: "claude",
      priority: 1,
      allowedModels: toExactRules(["claude-opus-4-5-20251001"]),
    });

    const session = createPickSession(
      "claude",
      [priorityZeroProvider, fallbackProvider],
      "claude-opus-4-5-20251001"
    );

    const { provider: picked, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(picked?.id).toBe(41);
    expect(context.selectedPriority).toBe(1);
    const mismatch = context.filteredProviders.find(
      (fp: any) => fp.id === 40 && fp.reason === "model_not_allowed"
    );
    expect(mismatch).toBeDefined();
  });
});
