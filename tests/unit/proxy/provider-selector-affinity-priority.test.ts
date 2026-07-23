import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

/**
 * F3a nomination priority inside ProxyProviderResolver.ensure():
 * with "ignore client session id" off: explicit session binding > affinity hint > weighted random;
 * with it on (product default) fingerprintable requests skip the session binding read entirely.
 * An affinity hint must still pass the full hard validation either way.
 */

const envControl = vi.hoisted(() => ({ affinityEnabled: true }));

const settingsControl = vi.hoisted(() => ({ ignoreClientSessionId: true }));

const storeMocks = vi.hoisted(() => ({
  lookup: vi.fn(async () => null as unknown),
  put: vi.fn(async () => {}),
  tombstone: vi.fn(async () => {}),
}));

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async (_providerId: number) => false),
  getCircuitState: vi.fn(() => "closed"),
}));

const vendorTypeCircuitMocks = vi.hoisted(() => ({
  isVendorTypeCircuitOpen: vi.fn(async () => false),
}));

const sessionManagerMocks = vi.hoisted(() => ({
  SessionManager: {
    getSessionProvider: vi.fn(async () => null as number | null),
    clearSessionProvider: vi.fn(async () => undefined),
    // 版本化绑定读不可用 -> findReusable 走 legacy getSessionProvider 回退，测试意图不变
    getSessionBindingSnapshot: vi.fn(async () => ({
      status: "unavailable" as const,
      reason: "redis_unavailable",
      capabilityState: "unknown",
      legacyFallbackAllowed: true,
    })),
    isSessionProviderCoolingDown: vi.fn(async () => ({
      status: "ok" as const,
      coolingDown: false,
      legacyFallbackAllowed: false as const,
    })),
  },
}));

const providerRepositoryMocks = vi.hoisted(() => ({
  findProviderById: vi.fn(async () => null as Provider | null),
  findAllProviders: vi.fn(async () => [] as Provider[]),
}));

const rateLimitMocks = vi.hoisted(() => ({
  RateLimitService: {
    checkCostLimitsWithLease: vi.fn(async () => ({ allowed: true })),
    checkTotalCostLimit: vi.fn(async () => ({ allowed: true, current: 0 })),
    checkAndTrackProviderSession: vi.fn(async () => ({
      allowed: true,
      count: 1,
      tracked: true,
      referenced: false,
    })),
  },
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);
vi.mock("@/lib/vendor-type-circuit-breaker", () => vendorTypeCircuitMocks);
vi.mock("@/lib/session-manager", () => sessionManagerMocks);
vi.mock("@/repository/provider", () => providerRepositoryMocks);
vi.mock("@/lib/rate-limit", () => rateLimitMocks);
vi.mock("@/repository/provider-groups", () => ({
  getGroupCostMultiplier: vi.fn(async () => 1),
}));
vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
}));
vi.mock("@/app/v1/_lib/proxy/provider-selector-settings-cache", () => ({
  getVerboseProviderErrorCached: vi.fn(async () => false),
}));
vi.mock("@/app/v1/_lib/proxy/affinity/affinity-store", () => ({
  getAffinityStore: () => storeMocks,
}));
vi.mock("@/lib/system-settings/proxy-runtime", () => ({
  getProxyRuntimeSettings: vi.fn(async () => ({
    streamGateMode: "off" as const,
    affinityIgnoreClientSessionId: settingsControl.ignoreClientSessionId,
  })),

  isCacheEffectivenessEnabled: () => false,
}));
vi.mock("@/lib/config/env.schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/env.schema")>();
  const baseEnv = actual.EnvSchema.parse({});
  return {
    ...actual,
    getEnvConfig: () => ({
      ...baseEnv,
      ENABLE_PREFIX_AFFINITY: envControl.affinityEnabled,
      // 指标模式（F3b）默认开启会独立建指纹状态；本文件聚焦提名优先级，显式关闭
      ENABLE_CACHE_EFFECTIVENESS: false,
      PREFIX_AFFINITY_WINDOW: 8,
      PREFIX_AFFINITY_TTL_SECONDS: 3600,
    }),
  };
});

import { ProxyProviderResolver } from "@/app/v1/_lib/proxy/provider-selector";

function makeProvider(id: number, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: `provider_${id}`,
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    disableSessionReuse: false,
    allowedModels: null,
    allowedClients: [],
    blockedClients: [],
    providerVendorId: null,
    activeTimeStart: null,
    activeTimeEnd: null,
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

const claudeMessage = {
  model: "claude-sonnet-4-5",
  system: "You are helpful.",
  messages: [{ role: "user", content: "hello" }],
};

// Minimal ProxySession stub; loose typing matches sibling selector tests.
function makeSession(overrides: Record<string, unknown> = {}): any {
  // 链条目联动：addProviderToChain 推入、getProviderChain 读出（覆盖粘性选择去重逻辑）
  const chainItems: Array<Record<string, unknown>> = [];
  const session: any = {
    sessionId: null,
    provider: null,
    affinity: null,
    originalFormat: "claude",
    userAgent: "claude-cli/2.0.0",
    authState: { key: { id: 5, providerGroup: "default" }, user: null },
    request: { message: claudeMessage },
    getEndpointPolicy: () => ({ kind: "default" }),
    shouldReuseProvider: () => false,
    getOriginalModel: () => "claude-sonnet-4-5",
    getCurrentModel: () => null,
    setProvider(p: Provider) {
      session.provider = p;
    },
    addProviderToChain: vi.fn((provider: Provider, metadata: Record<string, unknown> = {}) => {
      chainItems.push({ id: provider.id, ...metadata });
    }),
    getProviderChain: vi.fn(() => chainItems),
    setLastSelectionContext: vi.fn((ctx: unknown) => {
      session._ctx = ctx;
    }),
    getLastSelectionContext: vi.fn(() => session._ctx ?? null),
    setGroupCostMultiplier: vi.fn(),
    getProvidersSnapshot: vi.fn(async () => [makeProvider(55)]),
    recordProviderSessionRef: vi.fn(),
  };
  return Object.assign(session, overrides);
}

beforeEach(() => {
  vi.clearAllMocks();
  envControl.affinityEnabled = true;
  settingsControl.ignoreClientSessionId = true;
  storeMocks.lookup.mockResolvedValue(null);
  circuitBreakerMocks.isCircuitOpen.mockResolvedValue(false);
  circuitBreakerMocks.getCircuitState.mockReturnValue("closed");
  rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValue({ allowed: true });
  rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValue({
    allowed: true,
    current: 0,
  });
  rateLimitMocks.RateLimitService.checkAndTrackProviderSession.mockResolvedValue({
    allowed: true,
    count: 1,
    tracked: true,
    referenced: false,
  });
});

describe("ensure() nomination priority", () => {
  test("ignore-session off: explicit session binding wins and affinity lookup is never consulted", async () => {
    settingsControl.ignoreClientSessionId = false;
    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValue(91);
    providerRepositoryMocks.findProviderById.mockResolvedValue(makeProvider(91));

    const session = makeSession({
      sessionId: "sess_bound",
      shouldReuseProvider: () => true,
    });

    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(session.provider?.id).toBe(91);
    expect(storeMocks.lookup).not.toHaveBeenCalled();
    // 复用命中轮次仍要指纹状态：供终态写回加深前缀与 F3b 落值
    expect(session.affinity).not.toBeNull();
    expect(session.affinity?.nominatedProviderId).toBeNull();
  });

  test("affinity hit wins over weighted random and records affinity_hit in the chain", async () => {
    storeMocks.lookup.mockResolvedValue({
      providerId: 42,
      matchedFp: "deepfp",
      matchedIndex: 0,
      tier: "conversation",
    });
    providerRepositoryMocks.findProviderById.mockResolvedValue(makeProvider(42));

    const session = makeSession();
    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(session.provider?.id).toBe(42);
    expect(session.affinity?.nominatedProviderId).toBe(42);
    expect(session.affinity?.matchedFp).toBe("deepfp");
    expect(session.getProvidersSnapshot).not.toHaveBeenCalled();
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      expect.objectContaining({ reason: "affinity_hit", selectionMethod: "prefix_affinity" })
    );
    // 亲和提名已写入链：ensure 不得再补 initial_selection（否则决策链显示为加权随机初选）
    expect(session.getProviderChain().map((item: { reason?: string }) => item.reason)).toEqual([
      "affinity_hit",
    ]);

    const [, luaKeysCount] = storeMocks.lookup.mock.calls[0] as unknown as [string, string[]];
    expect(Array.isArray(luaKeysCount)).toBe(true);
  });

  test("affinity miss falls back to weighted random selection", async () => {
    const session = makeSession();
    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(storeMocks.lookup).toHaveBeenCalledTimes(1);
    expect(session.provider?.id).toBe(55);
    expect(session.affinity).not.toBeNull();
    expect(session.affinity?.nominatedProviderId).toBeNull();
  });

  test("affinity hit that fails hard validation falls back without nomination", async () => {
    storeMocks.lookup.mockResolvedValue({
      providerId: 42,
      matchedFp: "deepfp",
      matchedIndex: 0,
      tier: "conversation",
    });
    providerRepositoryMocks.findProviderById.mockResolvedValue(
      makeProvider(42, { isEnabled: false })
    );

    const session = makeSession();
    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(session.provider?.id).toBe(55);
    expect(session.affinity?.matchedFp).toBe("deepfp");
    expect(session.affinity?.nominatedProviderId).toBeNull();
  });

  test("circuit-open affinity candidate is rejected by hard validation", async () => {
    storeMocks.lookup.mockResolvedValue({
      providerId: 42,
      matchedFp: "deepfp",
      matchedIndex: 0,
      tier: "conversation",
    });
    providerRepositoryMocks.findProviderById.mockResolvedValue(makeProvider(42));
    circuitBreakerMocks.isCircuitOpen.mockImplementation(async (id: number) => id === 42);

    const session = makeSession();
    await ProxyProviderResolver.ensure(session);

    expect(session.provider?.id).toBe(55);
    expect(session.affinity?.nominatedProviderId).toBeNull();
  });

  test("env flag off and ignore-session setting off disable affinity entirely", async () => {
    envControl.affinityEnabled = false;
    settingsControl.ignoreClientSessionId = false;

    const session = makeSession();
    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(storeMocks.lookup).not.toHaveBeenCalled();
    expect(session.affinity).toBeNull();
    expect(session.provider?.id).toBe(55);
  });
});
