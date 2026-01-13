import { describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);

const rateLimitMocks = vi.hoisted(() => ({
  RateLimitService: {
    checkCostLimits: vi.fn(async () => ({ allowed: true })),
    checkTotalCostLimit: vi.fn(async () => ({ allowed: true, current: 0 })),
  },
}));

vi.mock("@/lib/rate-limit", () => rateLimitMocks);

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

describe("ProxyProviderResolver.filterByLimits - vendor+type fuse", () => {
  test("filters out providers when vendor+type fuse is open", async () => {
    vi.resetModules();

    const { openVendorTypeFuse } = await import("@/lib/endpoint-circuit-breaker");
    openVendorTypeFuse({ vendorId: 10, providerType: "claude", reason: "test" });

    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const providers: Provider[] = [
      {
        id: 1,
        name: "p1",
        isEnabled: true,
        vendorId: 10,
        providerType: "claude",
        groupTag: null,
        weight: 1,
        priority: 0,
        costMultiplier: 1,
        limit5hUsd: null,
        limitDailyUsd: null,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        totalCostResetAt: null,
        limitConcurrentSessions: 0,
      } as unknown as Provider,
      {
        id: 2,
        name: "p2",
        isEnabled: true,
        vendorId: 11,
        providerType: "claude",
        groupTag: null,
        weight: 1,
        priority: 0,
        costMultiplier: 1,
        limit5hUsd: null,
        limitDailyUsd: null,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        totalCostResetAt: null,
        limitConcurrentSessions: 0,
      } as unknown as Provider,
    ];

    const filtered = await (ProxyProviderResolver as any).filterByLimits(providers);
    expect(filtered.map((p: Provider) => p.id)).toEqual([2]);
  });
});
