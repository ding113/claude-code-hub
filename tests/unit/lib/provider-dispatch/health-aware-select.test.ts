import { describe, expect, it } from "vitest";
import {
  HEALTH_DISPATCH_MAX_AVG_FIRST_BYTE_MS,
  HEALTH_DISPATCH_MIN_ONLINE_RATE,
  meetsHealthDispatchSlo,
  selectBestHealthDispatchProvider,
  selectNextHealthDispatchAlternate,
} from "@/lib/provider-dispatch/health-aware-select";
import type { Provider } from "@/types/provider";

function fullWindow(ok = true) {
  return Array.from({ length: 5 }, () => ({ ok }));
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
    healthTestOnlineRate: null,
    healthTestAvgFirstByteMs: null,
    // Default full window so existing SLO tests stay valid; override to short for warm-up cases.
    healthTestRecentResults: fullWindow(true),
    ...partial,
  } as Provider;
}

describe("meetsHealthDispatchSlo", () => {
  it("requires both metrics", () => {
    expect(
      meetsHealthDispatchSlo(
        makeProvider({ id: 1, name: "a", healthTestOnlineRate: 1, healthTestAvgFirstByteMs: null })
      )
    ).toBe(false);
    expect(
      meetsHealthDispatchSlo(
        makeProvider({ id: 1, name: "a", healthTestOnlineRate: null, healthTestAvgFirstByteMs: 100 })
      )
    ).toBe(false);
  });

  it("requires a full 5-sample window before SLO qualifies", () => {
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 1,
          name: "short",
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 100,
          healthTestRecentResults: [{ ok: true }],
        })
      )
    ).toBe(false);
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 2,
          name: "full",
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 100,
          healthTestRecentResults: fullWindow(true),
        })
      )
    ).toBe(true);
  });

  it("enforces 80% / 10s inclusive thresholds", () => {
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 1,
          name: "ok",
          healthTestOnlineRate: HEALTH_DISPATCH_MIN_ONLINE_RATE,
          healthTestAvgFirstByteMs: HEALTH_DISPATCH_MAX_AVG_FIRST_BYTE_MS,
        })
      )
    ).toBe(true);
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 2,
          name: "low-rate",
          healthTestOnlineRate: 0.799,
          healthTestAvgFirstByteMs: 100,
        })
      )
    ).toBe(false);
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 3,
          name: "slow",
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 10_001,
        })
      )
    ).toBe(false);
  });

  it("excludes budget-paused or scheduled-off providers even with good SLO snapshots", () => {
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 1,
          name: "budget-paused",
          scheduledHealthTestEnabled: false,
          healthTestBudgetSuspendedDay: "2026-07-21",
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 100,
        })
      )
    ).toBe(false);
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 2,
          name: "manual-off",
          scheduledHealthTestEnabled: false,
          healthTestBudgetSuspendedDay: null,
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 100,
        })
      )
    ).toBe(false);
  });

  it("excludes disabled providers even with perfect 80%/10s snapshots", () => {
    expect(
      meetsHealthDispatchSlo(
        makeProvider({
          id: 3,
          name: "disabled",
          isEnabled: false,
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 50,
        })
      )
    ).toBe(false);
  });
});

describe("selectBestHealthDispatchProvider", () => {
  const resolvePriority = (p: Provider) => p.priority ?? 0;

  it("returns null when nobody meets SLO", () => {
    const result = selectBestHealthDispatchProvider(
      [
        makeProvider({
          id: 1,
          name: "bad",
          priority: 0,
          healthTestOnlineRate: 0.5,
          healthTestAvgFirstByteMs: 100,
        }),
      ],
      resolvePriority
    );
    expect(result).toBeNull();
  });

  it("skips disabled providers even if metrics look best", () => {
    const result = selectBestHealthDispatchProvider(
      [
        makeProvider({
          id: 1,
          name: "disabled-best",
          isEnabled: false,
          priority: 0,
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 10,
        }),
        makeProvider({
          id: 2,
          name: "enabled-ok",
          priority: 1,
          healthTestOnlineRate: 0.9,
          healthTestAvgFirstByteMs: 500,
        }),
      ],
      resolvePriority
    );
    expect(result?.provider.name).toBe("enabled-ok");
  });

  it("prefers higher priority (lower number) among SLO candidates", () => {
    const result = selectBestHealthDispatchProvider(
      [
        makeProvider({
          id: 1,
          name: "p2-fast",
          priority: 2,
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 100,
        }),
        makeProvider({
          id: 2,
          name: "p0-slower",
          priority: 0,
          healthTestOnlineRate: 0.9,
          healthTestAvgFirstByteMs: 900,
        }),
      ],
      resolvePriority
    );
    expect(result?.provider.name).toBe("p0-slower");
    expect(result?.mode).toBe("health_slo");
  });

  it("within same priority prefers lower avg first-byte", () => {
    const result = selectBestHealthDispatchProvider(
      [
        makeProvider({
          id: 1,
          name: "slow",
          priority: 0,
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 800,
        }),
        makeProvider({
          id: 2,
          name: "fast",
          priority: 0,
          healthTestOnlineRate: 0.95,
          healthTestAvgFirstByteMs: 200,
        }),
      ],
      resolvePriority
    );
    expect(result?.provider.name).toBe("fast");
  });
});

describe("selectNextHealthDispatchAlternate", () => {
  const resolvePriority = (p: Provider) => p.priority ?? 0;

  it("returns null when only one SLO peer exists", () => {
    const alt = selectNextHealthDispatchAlternate(
      [
        makeProvider({
          id: 1,
          name: "only",
          priority: 0,
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 100,
        }),
      ],
      resolvePriority,
      [1]
    );
    expect(alt).toBeNull();
  });

  it("returns second-best SLO peer after excluding primary", () => {
    const alt = selectNextHealthDispatchAlternate(
      [
        makeProvider({
          id: 1,
          name: "best",
          priority: 0,
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 100,
        }),
        makeProvider({
          id: 2,
          name: "second",
          priority: 1,
          healthTestOnlineRate: 0.9,
          healthTestAvgFirstByteMs: 200,
        }),
        makeProvider({
          id: 3,
          name: "bad",
          priority: 0,
          healthTestOnlineRate: 0.5,
          healthTestAvgFirstByteMs: 50,
        }),
      ],
      resolvePriority,
      [1]
    );
    expect(alt?.name).toBe("second");
  });
});
