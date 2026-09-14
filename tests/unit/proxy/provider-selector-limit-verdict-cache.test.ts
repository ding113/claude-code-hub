import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

vi.mock("@/lib/circuit-breaker", () => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));
vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: vi.fn(async () => false),
}));
vi.mock("@/lib/session-manager", () => ({ SessionManager: {} }));
vi.mock("@/repository/provider", () => ({ findAllProviders: vi.fn(async () => []) }));

const runtimeState = vi.hoisted(() => ({ highConcurrency: false }));
vi.mock("@/lib/system-settings/proxy-runtime", () => ({
  getProxyRuntimeSettings: vi.fn(async () => ({})),
  isCacheEffectivenessEnabled: () => false,
  isHighConcurrencyModeEnabledCached: () => runtimeState.highConcurrency,
}));

const rateLimitMocks = vi.hoisted(() => ({
  RateLimitService: {
    checkCostLimitsWithLease: vi.fn(async () => ({ allowed: true })),
    checkTotalCostLimit: vi.fn(async () => ({ allowed: true, current: 0 })),
  },
}));
vi.mock("@/lib/rate-limit", () => rateLimitMocks);

import {
  PROVIDER_LIMIT_VERDICT_TTL_HIGH_CONCURRENCY_MS,
  PROVIDER_LIMIT_VERDICT_TTL_MS,
  ProxyProviderResolver,
  resetProviderLimitVerdictCacheForTests,
} from "@/app/v1/_lib/proxy/provider-selector";

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "p1",
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    providerVendorId: null,
    limit5hUsd: null,
    limit5hResetMode: "rolling",
    limitDailyUsd: 20,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    ...overrides,
  } as unknown as Provider;
}

const filterByLimits = (providers: Provider[]) =>
  (
    ProxyProviderResolver as unknown as {
      filterByLimits(p: Provider[]): Promise<Provider[]>;
    }
  ).filterByLimits(providers);

describe("provider spend limit verdict cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    runtimeState.highConcurrency = false;
    resetProviderLimitVerdictCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("reuses a verdict for concurrent and repeated checks within the TTL", async () => {
    const provider = makeProvider();

    await Promise.all([filterByLimits([provider]), filterByLimits([provider])]);
    await filterByLimits([provider]);

    expect(rateLimitMocks.RateLimitService.checkCostLimitsWithLease).toHaveBeenCalledTimes(1);
    expect(rateLimitMocks.RateLimitService.checkTotalCostLimit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PROVIDER_LIMIT_VERDICT_TTL_MS + 1);
    await filterByLimits([provider]);
    expect(rateLimitMocks.RateLimitService.checkCostLimitsWithLease).toHaveBeenCalledTimes(2);
  });

  test("caches denied verdicts and lets limit edits bypass the cache", async () => {
    rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValueOnce({
      allowed: false,
      reason: "daily limit reached",
    } as never);
    const provider = makeProvider();

    expect(await filterByLimits([provider])).toEqual([]);
    expect(await filterByLimits([provider])).toEqual([]);
    expect(rateLimitMocks.RateLimitService.checkCostLimitsWithLease).toHaveBeenCalledTimes(1);

    const raised = makeProvider({ limitDailyUsd: 200 } as Partial<Provider>);
    expect(await filterByLimits([raised])).toEqual([raised]);
    expect(rateLimitMocks.RateLimitService.checkCostLimitsWithLease).toHaveBeenCalledTimes(2);
  });

  test("rejects on total spend without re-querying within the TTL", async () => {
    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValueOnce({
      allowed: false,
      current: 10,
      reason: "total reached",
    } as never);
    const provider = makeProvider({ limitDailyUsd: null, limitTotalUsd: 10 } as Partial<Provider>);

    expect(await filterByLimits([provider])).toEqual([]);
    expect(await filterByLimits([provider])).toEqual([]);
    expect(rateLimitMocks.RateLimitService.checkTotalCostLimit).toHaveBeenCalledTimes(1);
  });

  test("uses the longer TTL in high-concurrency mode", async () => {
    runtimeState.highConcurrency = true;
    const provider = makeProvider();

    await filterByLimits([provider]);
    vi.advanceTimersByTime(PROVIDER_LIMIT_VERDICT_TTL_MS + 1);
    await filterByLimits([provider]);
    expect(rateLimitMocks.RateLimitService.checkCostLimitsWithLease).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PROVIDER_LIMIT_VERDICT_TTL_HIGH_CONCURRENCY_MS);
    await filterByLimits([provider]);
    expect(rateLimitMocks.RateLimitService.checkCostLimitsWithLease).toHaveBeenCalledTimes(2);
  });

  test("does not cache providers without spend limits", async () => {
    const provider = makeProvider({ limitDailyUsd: null } as Partial<Provider>);

    await filterByLimits([provider]);
    await filterByLimits([provider]);

    expect(rateLimitMocks.RateLimitService.checkCostLimitsWithLease).toHaveBeenCalledTimes(2);
  });
});
