import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

const settingsMocks = vi.hoisted(() => ({
  getCachedSystemSettings: vi.fn(),
}));

const groupMocks = vi.hoisted(() => ({
  getProviderGroupSharedSettingsMap: vi.fn(async () => new Map()),
  getProviderGroupHealthTestModelsMap: vi.fn(async () => new Map()),
  getProviderGroupHealthTestModelFallbackMap: vi.fn(async () => new Map()),
  getProviderGroupModelMatchRules: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/config/system-settings-cache", () => settingsMocks);
vi.mock("@/repository/provider-groups", () => groupMocks);

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));
vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);

import { ProxyProviderResolver } from "@/app/v1/_lib/proxy/provider-selector";

function samples(ok = true, latencyMs = 100, count = 1): Provider["healthTestRecentResults"] {
  return Array.from({ length: count }, () => ({
    ok,
    firstByteMs: 10,
    latencyMs,
  })) as Provider["healthTestRecentResults"];
}

function makeProvider(
  id: number,
  name: string,
  costMultiplier: number,
  latencyMs = 100
): Provider {
  return {
    id,
    name,
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier,
    allowedModels: null,
    modelRedirects: null,
    scheduledHealthTestEnabled: true,
    healthTestBudgetSuspendedDay: null,
    healthTestOnlineRate: 1,
    healthTestAvgFirstByteMs: 10,
    healthTestRecentResults: samples(true, latencyMs),
  } as unknown as Provider;
}

function createSession(providers: Provider[]) {
  return {
    originalFormat: null,
    authState: null,
    getProvidersSnapshot: async () => providers,
    getOriginalModel: () => "",
    getCurrentModel: () => null,
    clientRequestsContext1m: () => false,
  } as any;
}

describe("ProxyProviderResolver.pickHealthSloAlternate - same-cost cold-start constraint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMocks.getCachedSystemSettings.mockResolvedValue({
      healthTestMinOnlineRatePercent: 90,
      healthTestMaxAvgLatencySeconds: 20,
    });
  });

  test("returns cheapest SLO peer when no sameCostAsProvider constraint (legacy behavior)", async () => {
    const primary = makeProvider(1, "primary", 1.0);
    const cheap = makeProvider(2, "cheap", 0.5, 50);
    const session = createSession([primary, cheap]);

    const result = await ProxyProviderResolver.pickHealthSloAlternate(session, [primary.id]);

    expect(result?.id).toBe(cheap.id);
  });

  test("returns only same-cost SLO peer when constraint matches", async () => {
    const primary = makeProvider(1, "primary", 1.0);
    const sameCost = makeProvider(2, "same-cost", 1.0, 50);
    const cheaper = makeProvider(3, "cheaper", 0.5, 10);
    const session = createSession([primary, sameCost, cheaper]);

    const result = await ProxyProviderResolver.pickHealthSloAlternate(session, [primary.id], primary);

    expect(result?.id).toBe(sameCost.id);
  });

  test("returns null when no same-cost SLO candidate exists", async () => {
    const primary = makeProvider(1, "primary", 1.0);
    const cheaper = makeProvider(2, "cheaper", 0.5, 10);
    const moreExpensive = makeProvider(3, "pricier", 2.0, 10);
    const session = createSession([primary, cheaper, moreExpensive]);

    const result = await ProxyProviderResolver.pickHealthSloAlternate(session, [primary.id], primary);

    expect(result).toBeNull();
  });

  test("same-cost filter prefers lower latency among equal-cost peers", async () => {
    const primary = makeProvider(1, "primary", 1.0);
    const sameCostSlow = makeProvider(2, "same-cost-slow", 1.0, 500);
    const sameCostFast = makeProvider(3, "same-cost-fast", 1.0, 20);
    const session = createSession([primary, sameCostSlow, sameCostFast]);

    const result = await ProxyProviderResolver.pickHealthSloAlternate(session, [primary.id], primary);

    expect(result?.id).toBe(sameCostFast.id);
  });
});
