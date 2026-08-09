import { describe, expect, it } from "vitest";
import { getProviderHealthTestStatus } from "@/app/[locale]/settings/providers/_components/provider-health-test-card";
import type { ProviderDisplay } from "@/types/provider";

function samples(ok = true, latencyMs = 20_000, count = 1): ProviderDisplay["healthTestRecentResults"] {
  return Array.from({ length: count }, () => ({
    ok,
    firstByteMs: 1_000,
    latencyMs,
  })) as ProviderDisplay["healthTestRecentResults"];
}

function provider(overrides: Partial<ProviderDisplay> = {}): ProviderDisplay {
  return {
    isEnabled: true,
    scheduledHealthTestEnabled: true,
    lastHealthTestOk: true,
    healthTestOnlineRate: 0.9,
    healthTestAvgFirstByteMs: 20_000,
    healthTestRecentResults: samples(),
    ...overrides,
  } as ProviderDisplay;
}

const translate = (key: string) => key;

describe("getProviderHealthTestStatus", () => {
  it("qualifies one sample at the inclusive online-rate and total-latency thresholds", () => {
    expect(getProviderHealthTestStatus(provider(), translate).text).toBe("healthTestOk");
  });

  it("fails when online rate is below the configured threshold", () => {
    expect(
      getProviderHealthTestStatus(provider({ healthTestOnlineRate: 0.8999 }), translate).text
    ).toBe("healthTestFailed");
  });

  it("fails when average total latency exceeds the configured threshold", () => {
    expect(
      getProviderHealthTestStatus(
        provider({ healthTestRecentResults: samples(true, 20_001) }),
        translate
      ).text
    ).toBe("healthTestFailed");
  });

  it("treats first-byte timing as display-only", () => {
    expect(
      getProviderHealthTestStatus(
        provider({ healthTestAvgFirstByteMs: 99_999, healthTestRecentResults: samples(true, 200) }),
        translate
      ).text
    ).toBe("healthTestOk");
  });

  it("uses runtime total-latency SLO thresholds", () => {
    expect(
      getProviderHealthTestStatus(
        provider({ healthTestRecentResults: samples(true, 5_001) }),
        translate,
        { minOnlineRate: 0.9, maxAvgLatencyMs: 5_000, minSampleCount: 1 }
      ).text
    ).toBe("healthTestFailed");
  });

  it("stays pending when samples do not carry a successful total latency", () => {
    expect(
      getProviderHealthTestStatus(
        provider({ healthTestRecentResults: [{ ok: true, firstByteMs: 1_000, latencyMs: null }] }),
        translate
      ).text
    ).toBe("healthTestPending");
  });

  it("shows failure when the latest probe failed and no usable SLO metrics remain", () => {
    expect(
      getProviderHealthTestStatus(
        provider({
          lastHealthTestOk: false,
          healthTestOnlineRate: null,
          healthTestRecentResults: samples(false),
        }),
        translate
      ).text
    ).toBe("healthTestFailed");
  });

  it("treats SLO auto-disabled probes as disabled", () => {
    expect(
      getProviderHealthTestStatus(provider({ healthTestSloAutoDisabled: true }), translate).text
    ).toBe("healthTestSloOff");
  });
});
