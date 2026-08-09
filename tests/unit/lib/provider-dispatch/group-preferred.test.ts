import { describe, expect, it } from "vitest";
import { pickPreferredProviderForGroup } from "@/lib/provider-dispatch/group-preferred";
import type { Provider } from "@/types/provider";

function samples(ok = true, latencyMs = 100, count = 1): Provider["healthTestRecentResults"] {
  return Array.from({ length: count }, () => ({
    ok,
    firstByteMs: 10,
    latencyMs,
  })) as Provider["healthTestRecentResults"];
}

function provider(partial: Partial<Provider> & { id: number; name: string }): Provider {
  return {
    groupTag: "grok",
    isEnabled: true,
    costMultiplier: 1,
    healthTestOnlineRate: 1,
    healthTestAvgFirstByteMs: 10,
    healthTestRecentResults: samples(),
    scheduledHealthTestEnabled: true,
    healthTestBudgetSuspendedDay: null,
    providerType: "claude",
    ...partial,
  } as Provider;
}

const thresholds = {
  minOnlineRate: 0.9,
  maxAvgLatencyMs: 1000,
  minSampleCount: 1,
};

describe("pickPreferredProviderForGroup model-specific health", () => {
  it("uses the exact requested model stats instead of aggregate stats", () => {
    const result = pickPreferredProviderForGroup(
      [
        provider({
          id: 1,
          name: "aggregate-green-model-bad",
          costMultiplier: 0.1,
          healthTestModelStats: {
            "grok-4": {
              onlineRate: 0.5,
              avgFirstByteMs: 10,
              recentResults: samples(false),
            },
          },
        }),
        provider({
          id: 2,
          name: "aggregate-bad-model-good",
          costMultiplier: 0.2,
          healthTestOnlineRate: 0.1,
          healthTestRecentResults: samples(true, 5_000),
          healthTestModelStats: {
            "grok-4": {
              onlineRate: 1,
              avgFirstByteMs: 20,
              recentResults: samples(true, 200),
            },
          },
        }),
      ],
      "grok",
      null,
      thresholds,
      "grok-4",
      new Map([["grok", ["grok-4"]]])
    );

    expect(result?.providerId).toBe(2);
    expect(result?.mode).toBe("health_slo");
    expect(result?.onlineRate).toBe(1);
  });

  it("does not reuse aggregate health when configured model stats are missing", () => {
    const result = pickPreferredProviderForGroup(
      [
        provider({
          id: 1,
          name: "aggregate-green-no-model-stats",
          costMultiplier: 0.1,
          healthTestModelStats: null,
        }),
      ],
      "grok",
      null,
      thresholds,
      "grok-4",
      new Map([["grok", ["grok-4"]]])
    );

    expect(result?.providerId).toBe(1);
    expect(result?.mode).toBe("legacy_priority");
    expect(result?.onlineRate).toBeNull();
    expect(result?.sampleCount).toBe(0);
  });

  it("uses the selected fallback model for a request outside the test-model list", () => {
    const result = pickPreferredProviderForGroup(
      [
        provider({
          id: 1,
          name: "cheapest-but-fallback-bad",
          costMultiplier: 0.1,
          healthTestModelStats: {
            "grok-5": {
              onlineRate: 0.5,
              avgFirstByteMs: 10,
              recentResults: samples(false),
            },
          },
        }),
        provider({
          id: 2,
          name: "fallback-good",
          costMultiplier: 0.2,
          healthTestModelStats: {
            "grok-5": {
              onlineRate: 1,
              avgFirstByteMs: 10,
              recentResults: samples(true, 200),
            },
          },
        }),
      ],
      "grok",
      null,
      thresholds,
      "non-test-model",
      new Map([["grok", ["grok-4", "grok-5"]]]),
      new Map([["grok", "grok-5"]])
    );

    expect(result?.providerId).toBe(2);
    expect(result?.mode).toBe("health_slo");
  });

  it("uses the first configured model when stored fallback data is invalid", () => {
    const result = pickPreferredProviderForGroup(
      [
        provider({
          id: 1,
          name: "first-model-good",
          healthTestModelStats: {
            "grok-4": {
              onlineRate: 1,
              avgFirstByteMs: 10,
              recentResults: samples(true, 100),
            },
            "grok-5": {
              onlineRate: 0,
              avgFirstByteMs: null,
              recentResults: samples(false),
            },
          },
        }),
      ],
      "grok",
      null,
      thresholds,
      "non-test-model",
      new Map([["grok", ["grok-4", "grok-5"]]]),
      new Map([["grok", "stale-model"]])
    );

    expect(result?.mode).toBe("health_slo");
    expect(result?.onlineRate).toBe(1);
  });
});
