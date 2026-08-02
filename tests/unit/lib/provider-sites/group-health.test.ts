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
  } as unknown as ProviderDisplay;
}

function sample(ok: boolean): ProviderDisplay["healthTestRecentResults"] {
  return Array.from({ length: 10 }, () => ({
    ok,
    firstByteMs: ok ? 1000 : null,
  })) as unknown as ProviderDisplay["healthTestRecentResults"];
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
      [member({ lastHealthTestOk: false, healthTestRecentResults: sample(false) })],
      "failed",
    ],
    [
      "at least one sampled key passed",
      [
        member({
          lastHealthTestOk: true,
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 1000,
          healthTestRecentResults: sample(true),
        }),
      ],
      "ok",
    ],
  ])("returns %s -> %s", (_caseName, members, expected) => {
    expect(resolveProviderSiteGroupHealthState(members)).toBe(
      expected as ProviderSiteGroupHealthState
    );
  });

  it("keeps a group qualified when one key passes and another key fails", () => {
    expect(
      resolveProviderSiteGroupHealthState([
        member({
          lastHealthTestOk: false,
          healthTestOnlineRate: 0,
          healthTestAvgFirstByteMs: null,
          healthTestRecentResults: sample(false),
        }),
        member({
          lastHealthTestOk: true,
          healthTestOnlineRate: 1,
          healthTestAvgFirstByteMs: 1000,
          healthTestRecentResults: sample(true),
        }),
      ])
    ).toBe("ok");
  });

  it("uses the configured online-rate floor and average first-byte ceiling", () => {
    const provider = member({
      lastHealthTestOk: true,
      healthTestOnlineRate: 0.89,
      healthTestAvgFirstByteMs: 1000,
      healthTestRecentResults: sample(true),
    });
    expect(resolveProviderSiteGroupHealthState([provider])).toBe("failed");
    expect(
      resolveProviderSiteGroupHealthState([provider], {
        minOnlineRate: 0.89,
        maxAvgFirstByteMs: 1000,
      })
    ).toBe("ok");
    expect(
      resolveProviderSiteGroupHealthState(
        [
          member({
            lastHealthTestOk: true,
            healthTestOnlineRate: 1,
            healthTestAvgFirstByteMs: 20_001,
            healthTestRecentResults: sample(true),
          }),
        ],
        { minOnlineRate: 0.9, maxAvgFirstByteMs: 20_000 }
      )
    ).toBe("failed");
  });
});
