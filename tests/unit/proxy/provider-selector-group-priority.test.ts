import { describe, expect, it } from "vitest";
import type { Provider } from "@/types/provider";
import { ProxyProviderResolver } from "@/app/v1/_lib/proxy/provider-selector";

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    id: 1,
    name: "test",
    url: "https://api.example.com",
    key: "sk-test",
    providerVendorId: null,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "claude",
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    joinClaudePool: false,
    codexInstructionsStrategy: "auto",
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
    circuitBreakerOpenDuration: 1800000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30000,
    streamingIdleTimeoutMs: 10000,
    requestTimeoutNonStreamingMs: 600000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("resolveEffectivePriority", () => {
  it("returns global priority when no groupPriorities", () => {
    const provider = makeProvider({ priority: 5, groupPriorities: null });
    expect(ProxyProviderResolver.resolveEffectivePriority(provider, "cli")).toBe(5);
  });

  it("returns group-specific priority when override exists", () => {
    const provider = makeProvider({
      priority: 5,
      groupPriorities: { cli: 0, chat: 2 },
    });
    expect(ProxyProviderResolver.resolveEffectivePriority(provider, "cli")).toBe(0);
    expect(ProxyProviderResolver.resolveEffectivePriority(provider, "chat")).toBe(2);
  });

  it("falls back to global when group not in overrides", () => {
    const provider = makeProvider({
      priority: 5,
      groupPriorities: { cli: 0 },
    });
    expect(ProxyProviderResolver.resolveEffectivePriority(provider, "chat")).toBe(5);
  });

  it("returns global priority when userGroup is null", () => {
    const provider = makeProvider({
      priority: 5,
      groupPriorities: { cli: 0 },
    });
    expect(ProxyProviderResolver.resolveEffectivePriority(provider, null)).toBe(5);
  });

  it("handles group priority of 0 correctly (not falsy)", () => {
    const provider = makeProvider({
      priority: 5,
      groupPriorities: { cli: 0 },
    });
    expect(ProxyProviderResolver.resolveEffectivePriority(provider, "cli")).toBe(0);
  });

  it("handles comma-separated user groups (multi-group)", () => {
    const provider = makeProvider({
      priority: 10,
      groupPriorities: { cli: 2, admin: 5, chat: 8 },
    });
    // Multi-group "cli,admin" should match both and take minimum (2)
    expect(ProxyProviderResolver.resolveEffectivePriority(provider, "cli,admin")).toBe(2);
    // Multi-group "admin,chat" should take minimum (5)
    expect(ProxyProviderResolver.resolveEffectivePriority(provider, "admin,chat")).toBe(5);
  });

  it("falls back to global when no group in multi-group matches", () => {
    const provider = makeProvider({
      priority: 10,
      groupPriorities: { cli: 2 },
    });
    // "admin,chat" has no matching overrides, should fall back to global (10)
    expect(ProxyProviderResolver.resolveEffectivePriority(provider, "admin,chat")).toBe(10);
  });

  it("handles partial match in multi-group", () => {
    const provider = makeProvider({
      priority: 10,
      groupPriorities: { cli: 3 },
    });
    // "cli,admin" - only "cli" matches, should return 3
    expect(ProxyProviderResolver.resolveEffectivePriority(provider, "cli,admin")).toBe(3);
  });
});

describe("selectTopPriority with group context", () => {
  // Access private method via bracket notation for testing
  const selectTopPriority = (providers: Provider[], userGroup?: string | null) =>
    (ProxyProviderResolver as any).selectTopPriority(providers, userGroup);

  it("selects providers by group-aware priority", () => {
    const providerA = makeProvider({
      id: 1,
      name: "A",
      priority: 5,
      groupPriorities: { cli: 0 },
    });
    const providerB = makeProvider({
      id: 2,
      name: "B",
      priority: 0,
      groupPriorities: null,
    });

    // cli group: A has effective priority 0, B has effective priority 0
    const result = selectTopPriority([providerA, providerB], "cli");
    expect(result).toHaveLength(2);
    expect(result.map((p: Provider) => p.id).sort()).toEqual([1, 2]);
  });

  it("without group context, uses global priority", () => {
    const providerA = makeProvider({
      id: 1,
      name: "A",
      priority: 5,
      groupPriorities: { cli: 0 },
    });
    const providerB = makeProvider({
      id: 2,
      name: "B",
      priority: 0,
      groupPriorities: null,
    });

    // no group: A has priority 5, B has priority 0 -> only B selected
    const result = selectTopPriority([providerA, providerB], null);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it("group override changes which providers are top priority", () => {
    const providerA = makeProvider({
      id: 1,
      name: "A",
      priority: 5,
      groupPriorities: { chat: 1 },
    });
    const providerB = makeProvider({
      id: 2,
      name: "B",
      priority: 3,
      groupPriorities: null,
    });

    // chat group: A=1, B=3 -> only A
    const chatResult = selectTopPriority([providerA, providerB], "chat");
    expect(chatResult).toHaveLength(1);
    expect(chatResult[0].id).toBe(1);

    // no group: A=5, B=3 -> only B
    const noGroupResult = selectTopPriority([providerA, providerB], null);
    expect(noGroupResult).toHaveLength(1);
    expect(noGroupResult[0].id).toBe(2);
  });
});
