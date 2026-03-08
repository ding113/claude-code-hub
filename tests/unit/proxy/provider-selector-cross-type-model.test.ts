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

describe("providerSupportsModel - cross-type model routing (#832)", () => {
  test("openai-compatible provider with claude model in allowedModels should match", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider = createProvider({
      id: 10,
      providerType: "openai-compatible",
      allowedModels: ["claude-opus-4-6"],
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

  test("openai-compatible provider with empty allowedModels should match any model (wildcard)", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider = createProvider({
      id: 11,
      providerType: "openai-compatible",
      allowedModels: null,
    });

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

  test("openai-compatible provider with allowedModels NOT containing the model should not match", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider = createProvider({
      id: 12,
      providerType: "openai-compatible",
      allowedModels: ["gpt-4o", "gpt-4o-mini"],
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

  test("claude provider with empty allowedModels should match any model (wildcard)", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider = createProvider({
      id: 13,
      providerType: "claude",
      allowedModels: null,
    });

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(13);
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce(provider);
    rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValueOnce({
      allowed: true,
    });
    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValueOnce({
      allowed: true,
      current: 0,
    });

    const session = {
      sessionId: "cross-type-4",
      shouldReuseProvider: () => true,
      getOriginalModel: () => "gpt-4o",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(13);
  });

  test("claude provider with non-claude model in allowedModels should match (explicit declaration)", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider = createProvider({
      id: 14,
      providerType: "claude",
      allowedModels: ["gemini-2.5-pro"],
    });

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(14);
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce(provider);
    rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValueOnce({
      allowed: true,
    });
    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValueOnce({
      allowed: true,
      current: 0,
    });

    const session = {
      sessionId: "cross-type-5",
      shouldReuseProvider: () => true,
      getOriginalModel: () => "gemini-2.5-pro",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(14);
  });

  test("any provider with modelRedirects containing the model should match", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const provider = createProvider({
      id: 15,
      providerType: "openai-compatible",
      allowedModels: ["gpt-4o"],
      modelRedirects: { "claude-opus-4-6": "custom-opus" },
    });

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(15);
    providerRepositoryMocks.findProviderById.mockResolvedValueOnce(provider);
    rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValueOnce({
      allowed: true,
    });
    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValueOnce({
      allowed: true,
      current: 0,
    });

    const session = {
      sessionId: "cross-type-6",
      shouldReuseProvider: () => true,
      getOriginalModel: () => "claude-opus-4-6",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(15);
  });
});
