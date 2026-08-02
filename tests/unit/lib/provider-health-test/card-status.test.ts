import { describe, expect, it } from "vitest";
import { getProviderHealthTestStatus } from "@/app/[locale]/settings/providers/_components/provider-health-test-card";
import type { ProviderDisplay } from "@/types/provider";

function provider(overrides: Partial<ProviderDisplay> = {}): ProviderDisplay {
  return {
    isEnabled: true,
    scheduledHealthTestEnabled: true,
    lastHealthTestOk: true,
    healthTestOnlineRate: 0.9,
    healthTestAvgFirstByteMs: 20_000,
    healthTestRecentResults: Array.from({ length: 10 }, () => ({
      ok: true,
      firstByteMs: 1_000,
    })),
    ...overrides,
  } as unknown as ProviderDisplay;
}

const translate = (key: string) => key;

describe("getProviderHealthTestStatus", () => {
  it("qualifies at the configured inclusive online-rate and first-byte thresholds", () => {
    expect(getProviderHealthTestStatus(provider(), translate).text).toBe("healthTestOk");
  });

  it("fails when online rate is below the configured threshold", () => {
    expect(
      getProviderHealthTestStatus(provider({ healthTestOnlineRate: 0.8999 }), translate).text
    ).toBe("healthTestFailed");
  });

  it("fails when average first-byte latency exceeds the configured threshold", () => {
    expect(
      getProviderHealthTestStatus(provider({ healthTestAvgFirstByteMs: 20_001 }), translate).text
    ).toBe("healthTestFailed");
  });

  it("uses runtime SLO thresholds instead of the default first-byte ceiling", () => {
    expect(
      getProviderHealthTestStatus(provider({ healthTestAvgFirstByteMs: 5_001 }), translate, {
        minOnlineRate: 0.9,
        maxAvgFirstByteMs: 5_000,
        minSampleCount: 10,
      }).text
    ).toBe("healthTestFailed");
  });

  it("treats SLO auto-disabled probes as disabled", () => {
    expect(
      getProviderHealthTestStatus(provider({ healthTestSloAutoDisabled: true }), translate).text
    ).toBe("healthTestSloOff");
  });

  it("stays pending until the configured rolling window is complete", () => {
    expect(
      getProviderHealthTestStatus(
        provider({
          healthTestRecentResults: Array.from({ length: 9 }, () => ({
            ok: true,
            firstByteMs: 1_000,
          })),
        }),
        translate
      ).text
    ).toBe("healthTestPending");
  });

  it("shows failure when a complete window has no aggregate metrics but the latest probe failed", () => {
    expect(
      getProviderHealthTestStatus(
        provider({
          lastHealthTestOk: false,
          healthTestOnlineRate: null,
          healthTestAvgFirstByteMs: null,
        }),
        translate
      ).text
    ).toBe("healthTestFailed");
  });
});
