import { describe, expect, it } from "vitest";
import {
  resolveProviderSiteGroupHealthState,
  type ProviderSiteGroupHealthState,
} from "@/lib/provider-sites/group-health";
import type { ProviderDisplay } from "@/types/provider";

function member(overrides: Partial<ProviderDisplay> = {}): ProviderDisplay {
  return {
    isEnabled: true,
    scheduledHealthTestEnabled: true,
    lastHealthTestOk: null,
    healthTestOnlineRate: null,
    healthTestAvgFirstByteMs: null,
    healthTestRecentResults: null,
    ...overrides,
  } as ProviderDisplay;
}

function samples(ok = true, latencyMs = 1_000, count = 1): ProviderDisplay["healthTestRecentResults"] {
  return Array.from({ length: count }, () => ({
    ok,
    firstByteMs: 10,
    latencyMs,
  })) as ProviderDisplay["healthTestRecentResults"];
}

describe("resolveProviderSiteGroupHealthState", () => {
  it.each([
    ["empty", [], "pending"],
    ["scheduled test has not produced a sample", [member()], "pending"],
    ["all linked keys are disabled", [member({ isEnabled: false })], "disabled"],
    ["scheduled testing is disabled", [member({ scheduledHealthTestEnabled: false })], "disabled"],
    ["SLO auto-disabled", [member({ healthTestSloAutoDisabled: true })], "disabled"],
    [
      "all sampled keys failed",
      [member({ lastHealthTestOk: false, healthTestRecentResults: samples(false) })],
      "failed",
    ],
    [
      "at least one sampled key passed",
      [
        member({
          lastHealthTestOk: true,
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 10,
          healthTestRecentResults: samples(true),
        }),
      ],
      "ok",
    ],
  ])("returns %s -> %s", (_caseName, members, expected) => {
    expect(resolveProviderSiteGroupHealthState(members as ProviderDisplay[])).toBe(
      expected as ProviderSiteGroupHealthState
    );
  });

  it("keeps a group qualified when one key passes and another key fails", () => {
    expect(
      resolveProviderSiteGroupHealthState([
        member({
          lastHealthTestOk: false,
          healthTestOnlineRate: 0,
          healthTestRecentResults: samples(false),
        }),
        member({
          lastHealthTestOk: true,
          healthTestOnlineRate: 1,
          healthTestRecentResults: samples(true),
        }),
      ])
    ).toBe("ok");
  });

  it("uses the configured online-rate floor and total-latency ceiling", () => {
    const provider = member({
      lastHealthTestOk: true,
      healthTestOnlineRate: 0.89,
      healthTestRecentResults: samples(true, 1_000),
    });
    expect(resolveProviderSiteGroupHealthState([provider])).toBe("failed");
    expect(
      resolveProviderSiteGroupHealthState([provider], {
        minOnlineRate: 0.89,
        maxAvgLatencyMs: 1_000,
      })
    ).toBe("ok");
    expect(
      resolveProviderSiteGroupHealthState(
        [member({ healthTestOnlineRate: 1, healthTestRecentResults: samples(true, 20_001) })],
        { minOnlineRate: 0.9, maxAvgLatencyMs: 20_000 }
      )
    ).toBe("failed");
  });

  it("uses fallback-model stats instead of aggregate health", () => {
    const fallbackBad = member({
      lastHealthTestOk: true,
      healthTestOnlineRate: 1,
      healthTestRecentResults: samples(true, 100),
      healthTestModelStats: {
        "grok-5": {
          onlineRate: 0,
          avgFirstByteMs: null,
          recentResults: samples(false),
        },
      },
    });
    expect(resolveProviderSiteGroupHealthState([fallbackBad], undefined, undefined, "grok-5")).toBe(
      "failed"
    );

    const missingFallbackStats = member({
      lastHealthTestOk: true,
      healthTestOnlineRate: 1,
      healthTestRecentResults: samples(true, 100),
      healthTestModelStats: null,
    });
    expect(
      resolveProviderSiteGroupHealthState([missingFallbackStats], undefined, undefined, "grok-5")
    ).toBe("pending");
  });
});
