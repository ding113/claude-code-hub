import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProxyProviderResolver } from "@/app/v1/_lib/proxy/provider-selector";
import { resolveCrossGroupDegradation } from "@/app/v1/_lib/proxy/degradation-config";
import type { Provider } from "@/types/provider";
import type { SystemSettings } from "@/types/system-config";
import type { EnvConfig } from "@/lib/config/env.schema";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { ProviderChainItem } from "@/types/message";
import { getSystemSettings } from "@/repository/system-config";
import { getEnvConfig } from "@/lib/config/env.schema";
import { findProviderList } from "@/repository/provider";
import { RateLimitService } from "@/lib/rate-limit";
import { isCircuitOpen, getCircuitState } from "@/lib/circuit-breaker";

vi.mock("@/repository/provider", () => ({
  findProviderList: vi.fn(),
  findProviderById: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    checkCostLimits: vi.fn(),
    checkAndTrackProviderSession: vi.fn(),
  },
}));

vi.mock("@/lib/circuit-breaker", () => ({
  isCircuitOpen: vi.fn(),
  getCircuitState: vi.fn(),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
  getProviderHealthInfo: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    getSessionProvider: vi.fn(),
    updateSessionBindingSmart: vi.fn(),
    updateSessionProvider: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

const getSystemSettingsMock = vi.mocked(getSystemSettings);
const getEnvConfigMock = vi.mocked(getEnvConfig);
const findProviderListMock = vi.mocked(findProviderList);
const checkCostLimitsMock = vi.mocked(RateLimitService.checkCostLimits);
const checkAndTrackProviderSessionMock = vi.mocked(RateLimitService.checkAndTrackProviderSession);
const isCircuitOpenMock = vi.mocked(isCircuitOpen);
const getCircuitStateMock = vi.mocked(getCircuitState);

function createSystemSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  return {
    id: overrides.id ?? 1,
    siteTitle: overrides.siteTitle ?? "Test Site",
    allowGlobalUsageView: overrides.allowGlobalUsageView ?? false,
    allowCrossGroupOnDegrade: overrides.allowCrossGroupOnDegrade ?? false,
    currencyDisplay: overrides.currencyDisplay ?? "USD",
    enableAutoCleanup: overrides.enableAutoCleanup ?? false,
    cleanupRetentionDays: overrides.cleanupRetentionDays ?? 30,
    cleanupSchedule: overrides.cleanupSchedule ?? "0 2 * * *",
    cleanupBatchSize: overrides.cleanupBatchSize ?? 10000,
    enableClientVersionCheck: overrides.enableClientVersionCheck ?? false,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

function createEnvConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    NODE_ENV: "test",
    DSN: undefined,
    ADMIN_TOKEN: undefined,
    AUTO_MIGRATE: true,
    PORT: 23000,
    REDIS_URL: undefined,
    ENABLE_RATE_LIMIT: true,
    ENABLE_SECURE_COOKIES: true,
    SESSION_TTL: 300,
    DEBUG_MODE: false,
    LOG_LEVEL: "info",
    TZ: "Asia/Shanghai",
    ENABLE_MULTI_PROVIDER_TYPES: false,
    ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS: false,
    ALLOW_CROSS_GROUP_DEGRADE: undefined,
    FETCH_BODY_TIMEOUT: 120000,
    FETCH_HEADERS_TIMEOUT: 60000,
    FETCH_CONNECT_TIMEOUT: 30000,
    ENABLE_WEBSOCKET: true,
    WEBSOCKET_PATH: "/socket.io",
    APP_PORT: 23000,
    ...overrides,
  };
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "Provider",
    url: overrides.url ?? "https://example.com",
    key: overrides.key ?? "key",
    isEnabled: overrides.isEnabled ?? true,
    weight: overrides.weight ?? 1,
    priority: overrides.priority ?? 0,
    costMultiplier: overrides.costMultiplier ?? 1,
    groupTag: overrides.groupTag ?? null,
    groupTags: overrides.groupTags ?? null,
    providerType: overrides.providerType ?? "claude",
    modelRedirects: overrides.modelRedirects ?? null,
    allowedModels: overrides.allowedModels ?? null,
    joinClaudePool: overrides.joinClaudePool ?? false,
    codexInstructionsStrategy: overrides.codexInstructionsStrategy ?? "auto",
    limit5hUsd: overrides.limit5hUsd ?? null,
    limitWeeklyUsd: overrides.limitWeeklyUsd ?? null,
    limitMonthlyUsd: overrides.limitMonthlyUsd ?? null,
    limitConcurrentSessions: overrides.limitConcurrentSessions ?? 0,
    circuitBreakerFailureThreshold: overrides.circuitBreakerFailureThreshold ?? 5,
    circuitBreakerOpenDuration: overrides.circuitBreakerOpenDuration ?? 30000,
    circuitBreakerHalfOpenSuccessThreshold: overrides.circuitBreakerHalfOpenSuccessThreshold ?? 2,
    proxyUrl: overrides.proxyUrl ?? null,
    proxyFallbackToDirect: overrides.proxyFallbackToDirect ?? false,
    websiteUrl: overrides.websiteUrl ?? null,
    faviconUrl: overrides.faviconUrl ?? null,
    tpm: overrides.tpm ?? null,
    rpm: overrides.rpm ?? null,
    rpd: overrides.rpd ?? null,
    cc: overrides.cc ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    deletedAt: overrides.deletedAt,
  };
}

function createSessionMock() {
  let lastContext: ProviderChainItem["decisionContext"] | undefined;
  const addProviderToChain = vi.fn();
  const sessionObject = {
    provider: null,
    sessionId: "session-1",
    authState: { user: { name: "tester", providerGroup: "alpha" } },
    shouldReuseProvider: vi.fn(() => false),
    setProvider: vi.fn((provider: Provider | null) => {
      sessionObject.provider = provider;
    }),
    getCurrentModel: vi.fn(() => "claude-3"),
    setLastSelectionContext: vi.fn((context) => {
      lastContext = context;
    }),
    getLastSelectionContext: vi.fn(() => lastContext),
    addProviderToChain,
  } as Record<string, unknown>;

  return { session: sessionObject as unknown as ProxySession, addProviderToChain };
}

beforeEach(() => {
  getEnvConfigMock.mockReturnValue(createEnvConfig());
  getSystemSettingsMock.mockResolvedValue(createSystemSettings());
  findProviderListMock.mockResolvedValue([]);
  checkCostLimitsMock.mockResolvedValue({ allowed: true });
  checkAndTrackProviderSessionMock.mockResolvedValue({ allowed: true, count: 0, tracked: true });
  isCircuitOpenMock.mockResolvedValue(false);
  getCircuitStateMock.mockReturnValue("closed");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("resolveCrossGroupDegradation", () => {
  it("prefers database setting when available", async () => {
    getSystemSettingsMock.mockResolvedValue(
      createSystemSettings({ id: 42, allowCrossGroupOnDegrade: true })
    );
    getEnvConfigMock.mockReturnValue(createEnvConfig({ ALLOW_CROSS_GROUP_DEGRADE: false }));

    const result = await resolveCrossGroupDegradation();

    expect(result).toEqual({ allowed: true, source: "database" });
    expect(getSystemSettingsMock).toHaveBeenCalled();
  });

  it("falls back to environment variable when database unavailable", async () => {
    getSystemSettingsMock.mockRejectedValueOnce(new Error("db unavailable"));
    getEnvConfigMock.mockReturnValue(createEnvConfig({ ALLOW_CROSS_GROUP_DEGRADE: true }));

    const result = await resolveCrossGroupDegradation();

    expect(result).toEqual({ allowed: true, source: "environment" });
  });

  it("returns default false when no configuration sources", async () => {
    getSystemSettingsMock.mockRejectedValueOnce(new Error("db missing"));
    getEnvConfigMock.mockReturnValue(createEnvConfig({ ALLOW_CROSS_GROUP_DEGRADE: undefined }));

    const result = await resolveCrossGroupDegradation();

    expect(result).toEqual({ allowed: false, source: "default" });
  });
});

function invokePickRandomProvider(session?: ProxySession, exclude: number[] = []) {
  const pick = (
    ProxyProviderResolver as unknown as {
      pickRandomProvider(
        session?: ProxySession,
        excludeIds?: number[]
      ): Promise<{
        provider: Provider | null;
        context: NonNullable<ProviderChainItem["decisionContext"]>;
      }>;
    }
  ).pickRandomProvider;

  return pick.call(ProxyProviderResolver, session, exclude);
}

describe("pickRandomProvider cross-group degradation", () => {
  it("keeps strict group filtering when matching providers exist", async () => {
    const matching = createProvider({
      id: 1,
      name: "GroupA",
      groupTag: "alpha",
      groupTags: ["alpha"],
    });
    const fallback = createProvider({
      id: 2,
      name: "GroupB",
      groupTag: "beta",
      groupTags: ["beta"],
    });
    findProviderListMock.mockResolvedValue([matching, fallback]);

    const session = {
      getCurrentModel: () => "claude-3",
      authState: { user: { providerGroup: "alpha" } },
    } as unknown as ProxySession;

    const { provider, context } = await invokePickRandomProvider(session, []);

    expect(provider?.id).toBe(1);
    expect(context.crossGroupDegradationUsed).toBe(false);
    expect(checkCostLimitsMock).toHaveBeenCalledTimes(1);
    expect(isCircuitOpenMock).toHaveBeenCalledTimes(1);
  });

  it("degrades to global pool when user group empty and config enabled", async () => {
    getSystemSettingsMock.mockResolvedValue(
      createSystemSettings({ id: 99, allowCrossGroupOnDegrade: true })
    );
    const fallback = createProvider({
      id: 10,
      name: "Fallback",
      groupTag: "beta",
      groupTags: ["beta"],
    });
    findProviderListMock.mockResolvedValue([fallback]);

    const session = {
      getCurrentModel: () => "claude-3",
      authState: { user: { providerGroup: "alpha" } },
    } as unknown as ProxySession;

    const { provider, context } = await invokePickRandomProvider(session, []);

    expect(provider?.id).toBe(10);
    expect(context.crossGroupDegradationUsed).toBe(true);
    expect(context.degradationReason).toContain("降级");
    expect(checkCostLimitsMock).toHaveBeenCalledTimes(1);
    expect(isCircuitOpenMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when degradation disabled and no group match", async () => {
    getSystemSettingsMock.mockResolvedValue(
      createSystemSettings({ id: 15, allowCrossGroupOnDegrade: false })
    );
    const fallback = createProvider({
      id: 20,
      name: "Other",
      groupTag: "beta",
      groupTags: ["beta"],
    });
    findProviderListMock.mockResolvedValue([fallback]);

    const session = {
      getCurrentModel: () => "claude-3",
      authState: { user: { providerGroup: "alpha" } },
    } as unknown as ProxySession;

    const { provider, context } = await invokePickRandomProvider(session, []);

    expect(provider).toBeNull();
    expect(context.crossGroupDegradationUsed).toBe(false);
    expect(context.degradationReason).toBe("跨组降级未启用");
  });
});

describe("provider chain reason recording", () => {
  function setupEnsureTest(crossGroup: boolean) {
    const provider = createProvider({ id: crossGroup ? 777 : 778, groupTag: "beta" });
    const context: ProviderChainItem["decisionContext"] = {
      totalProviders: 1,
      enabledProviders: 1,
      targetType: "claude",
      requestedModel: "claude-3",
      groupFilterApplied: false,
      beforeHealthCheck: 1,
      afterHealthCheck: 1,
      filteredProviders: [],
      priorityLevels: [0],
      selectedPriority: 0,
      candidatesAtPriority: [],
      crossGroupDegradationUsed: crossGroup,
      degradationReason: crossGroup ? "无组可用，已降级" : undefined,
    };

    const resolverWithPrivateAccess = ProxyProviderResolver as unknown as {
      findReusable(): Promise<Provider | null>;
      pickRandomProvider(
        session?: ProxySession,
        excludeIds?: number[]
      ): Promise<{
        provider: Provider | null;
        context: NonNullable<ProviderChainItem["decisionContext"]>;
      }>;
    };

    vi.spyOn(resolverWithPrivateAccess, "findReusable").mockResolvedValueOnce(null);
    vi.spyOn(resolverWithPrivateAccess, "pickRandomProvider").mockResolvedValueOnce({
      provider,
      context,
    });

    const { session, addProviderToChain } = createSessionMock();
    session.sessionId = "session-id";
    return { session, addProviderToChain };
  }

  it("records cross_group_degradation when decision context indicates degradation", async () => {
    const { session, addProviderToChain } = setupEnsureTest(true);

    await ProxyProviderResolver.ensure(session);

    const call = addProviderToChain.mock.calls.find(([, meta]) => meta?.reason);
    expect(call?.[1]?.reason).toBe("cross_group_degradation");
  });

  it("records initial_selection when no degradation", async () => {
    const { session, addProviderToChain } = setupEnsureTest(false);

    await ProxyProviderResolver.ensure(session);

    const call = addProviderToChain.mock.calls.find(([, meta]) => meta?.reason);
    expect(call?.[1]?.reason).toBe("initial_selection");
  });
});
