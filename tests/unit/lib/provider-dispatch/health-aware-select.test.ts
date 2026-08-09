import { describe, expect, it } from "vitest";
import {
  HEALTH_DISPATCH_MAX_AVG_LATENCY_MS,
  HEALTH_DISPATCH_MIN_ONLINE_RATE,
  meetsHealthDispatchSlo,
  selectBestHealthDispatchProvider,
  selectFastestProvider,
  selectNextHealthDispatchAlternate,
} from "@/lib/provider-dispatch/health-aware-select";
import type { Provider } from "@/types/provider";

function samples(ok = true, latencyMs = 100, count = 1): Provider["healthTestRecentResults"] {
  return Array.from({ length: count }, () => ({
    ok,
    firstByteMs: 10,
    latencyMs,
  })) as Provider["healthTestRecentResults"];
}

function makeProvider(partial: Partial<Provider> & { id: number; name: string }): Provider {
  return {
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    isEnabled: true,
    providerType: "claude",
    scheduledHealthTestEnabled: true,
    healthTestBudgetSuspendedDay: null,
    healthTestOnlineRate: 1,
    healthTestAvgFirstByteMs: 10,
    healthTestRecentResults: samples(),
    ...partial,
  } as Provider;
}

describe("meetsHealthDispatchSlo", () => {
  it("requires an online rate and successful total-latency samples", () => {
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 1,
          name: "no-latency",
          healthTestRecentResults: [{ ok: true, latencyMs: null }],
        })
      )
    ).toBe(false);
    expect(
      meetsHealthDispatchSlo(
        makeProvider({ id: 2, name: "no-rate", healthTestOnlineRate: null })
      )
    ).toBe(false);
  });

  it("allows one qualifying sample; the rolling window is not an SLO gate", () => {
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 1,
          name: "one-sample",
          healthTestOnlineRate: 1,
          healthTestRecentResults: samples(true, 100, 1),
        })
      )
    ).toBe(true);
  });

  it("uses inclusive 90% / 20s total-latency thresholds", () => {
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 1,
          name: "ok",
          healthTestOnlineRate: HEALTH_DISPATCH_MIN_ONLINE_RATE,
          healthTestRecentResults: samples(true, HEALTH_DISPATCH_MAX_AVG_LATENCY_MS),
        })
      )
    ).toBe(true);
    expect(
      meetsHealthDispatchSlo(
        makeProvider({ id: 2, name: "low-rate", healthTestOnlineRate: 0.899 })
      )
    ).toBe(false);
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 3,
          name: "slow",
          healthTestRecentResults: samples(true, HEALTH_DISPATCH_MAX_AVG_LATENCY_MS + 1),
        })
      )
    ).toBe(false);
  });

  it("does not use display-only first-byte timing as the SLO metric", () => {
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 1,
          name: "high-ttfb-fast-total",
          healthTestAvgFirstByteMs: 99_999,
          healthTestRecentResults: samples(true, 200),
        })
      )
    ).toBe(true);
  });

  it("excludes budget-paused, scheduled-off, auto-disabled, and disabled providers", () => {
    for (const provider of [
      makeProvider({
        id: 1,
        name: "budget-paused",
        scheduledHealthTestEnabled: false,
        healthTestBudgetSuspendedDay: "2026-07-21",
      }),
      makeProvider({ id: 2, name: "manual-off", scheduledHealthTestEnabled: false }),
      makeProvider({ id: 3, name: "slo-auto-disabled", healthTestSloAutoDisabled: true }),
      makeProvider({ id: 4, name: "disabled", isEnabled: false }),
    ]) {
      expect(meetsHealthDispatchSlo(provider)).toBe(false);
    }
  });
});

describe("selectBestHealthDispatchProvider", () => {
  it("returns null when nobody meets SLO", () => {
    const result = selectBestHealthDispatchProvider([
      makeProvider({ id: 1, name: "bad", costMultiplier: 0.01, healthTestOnlineRate: 0.5 }),
    ]);
    expect(result).toBeNull();
  });

  it("skips disabled providers even if their metrics look best", () => {
    const result = selectBestHealthDispatchProvider([
      makeProvider({ id: 1, name: "disabled-best", isEnabled: false, costMultiplier: 0.01 }),
      makeProvider({ id: 2, name: "enabled-ok", costMultiplier: 0.5 }),
    ]);
    expect(result?.provider.name).toBe("enabled-ok");
  });

  it("ranks qualifying peers by cost, then total latency, then provider id", () => {
    const result = selectBestHealthDispatchProvider([
      makeProvider({
        id: 4,
        name: "expensive-fast",
        costMultiplier: 1,
        healthTestRecentResults: samples(true, 10),
      }),
      makeProvider({
        id: 3,
        name: "cheap-slower",
        costMultiplier: 0.1,
        healthTestRecentResults: samples(true, 900),
      }),
      makeProvider({
        id: 2,
        name: "cheap-fast",
        costMultiplier: 0.1,
        healthTestRecentResults: samples(true, 200),
      }),
      makeProvider({
        id: 1,
        name: "cheap-fast-lower-id",
        costMultiplier: 0.1,
        healthTestRecentResults: samples(true, 200),
      }),
    ]);
    expect(result?.provider.name).toBe("cheap-fast-lower-id");
    expect(result?.mode).toBe("health_slo");
  });
});

describe("selectFastestProvider", () => {
  it("uses the shortest average total latency when no provider meets SLO", () => {
    const result = selectFastestProvider([
      makeProvider({
        id: 1,
        name: "cheap-slow",
        costMultiplier: 0.01,
        healthTestRecentResults: samples(true, 900),
      }),
      makeProvider({
        id: 2,
        name: "expensive-fast",
        costMultiplier: 1,
        healthTestRecentResults: samples(true, 200),
      }),
    ]);

    expect(result?.name).toBe("expensive-fast");
  });

  it("puts providers without a usable latency average after measured providers", () => {
    const result = selectFastestProvider([
      makeProvider({
        id: 1,
        name: "unmeasured-cheap",
        costMultiplier: 0.01,
        healthTestRecentResults: [{ ok: false, latencyMs: null }],
      }),
      makeProvider({
        id: 2,
        name: "measured",
        costMultiplier: 1,
        healthTestRecentResults: samples(true, 20),
      }),
    ]);

    expect(result?.name).toBe("measured");
  });
});

describe("selectNextHealthDispatchAlternate", () => {
  it("returns null when only one SLO peer exists", () => {
    const alt = selectNextHealthDispatchAlternate(
      [makeProvider({ id: 1, name: "only", costMultiplier: 0.1 })],
      (provider: Provider) => Number(provider.costMultiplier) || 1,
      [1]
    );
    expect(alt).toBeNull();
  });

  it("returns the next cheapest SLO peer after excluding the primary", () => {
    const alt = selectNextHealthDispatchAlternate(
      [
        makeProvider({ id: 1, name: "best", costMultiplier: 0.05 }),
        makeProvider({ id: 2, name: "second", costMultiplier: 0.2 }),
        makeProvider({ id: 3, name: "bad", costMultiplier: 0.01, healthTestOnlineRate: 0.5 }),
      ],
      (provider: Provider) => Number(provider.costMultiplier) || 1,
      [1]
    );
    expect(alt?.name).toBe("second");
  });
});
