import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

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

function createHaikuOnlyProvider(): Provider {
  return {
    id: 78,
    name: "zhipu_Haiku",
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 1,
    costMultiplier: 1,
    allowedModels: ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
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
  } as unknown as Provider;
}

function createOpusProvider(): Provider {
  return {
    id: 94,
    name: "yescode_team",
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    allowedModels: null, // supports all claude models
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
  } as unknown as Provider;
}

describe("findReusable - model mismatch clears stale binding", () => {
  test("should clear stale binding when bound provider does not support requested model", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    // Session bound to haiku-only provider
    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(78);
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce(createHaikuOnlyProvider());

    const session = {
      sessionId: "4c25cf92",
      shouldReuseProvider: () => true,
      getOriginalModel: () => "claude-opus-4-6",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    // Key assertion: clearSessionProvider should have been called
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      "4c25cf92"
    );
  });

  test("should NOT clear binding when bound provider supports requested model", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    // Session bound to provider that supports all claude models
    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(94);
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce(createOpusProvider());
    rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValueOnce({
      allowed: true,
    });
    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValueOnce({
      allowed: true,
      current: 0,
    });

    const session = {
      sessionId: "sess_ok",
      shouldReuseProvider: () => true,
      getOriginalModel: () => "claude-opus-4-6",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    // Should return the provider (model matches)
    expect(result).not.toBeNull();
    expect(result?.id).toBe(94);
    // clearSessionProvider should NOT have been called
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).not.toHaveBeenCalled();
  });

  test("should NOT clear binding when shouldReuseProvider returns false", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const session = {
      sessionId: "sess_short",
      shouldReuseProvider: () => false,
      getOriginalModel: () => "claude-opus-4-6",
      authState: null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    // Should not even reach the model check, so no clear
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).not.toHaveBeenCalled();
    expect(sessionManagerMocks.SessionManager.getSessionProvider).not.toHaveBeenCalled();
  });

  test("should clear binding for haiku-only provider when requesting haiku-4-5 variant not in allowlist", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(78);
    const provider = createHaikuOnlyProvider();
    // Restrictive allowlist - only allows specific variant
    provider.allowedModels = ["claude-haiku-4-5-20251001"];
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce(provider);

    const session = {
      sessionId: "sess_variant",
      shouldReuseProvider: () => true,
      getOriginalModel: () => "claude-sonnet-4-5-20250929",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      "sess_variant"
    );
  });
});
