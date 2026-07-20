import { describe, expect, it } from "vitest";
import { UpdateSystemSettingsSchema } from "@/lib/validation/schemas";

describe("UpdateSystemSettingsSchema Discovery settings", () => {
  it("accepts the recommended defaults", () => {
    const result = UpdateSystemSettingsSchema.parse({
      discoveryEnabled: false,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 2,
      discoverySlaMs: 10_000,
      stickySlaMs: 20_000,
      racingTotalTimeoutMs: 60_000,
      stickyTimeoutCooldownMs: 300_000,
    });
    expect(result.discoveryConcurrency).toBe(2);
  });

  it("rejects a total deadline shorter than the configured discovery window", () => {
    expect(() =>
      UpdateSystemSettingsSchema.parse({
        discoverySlaMs: 10_000,
        stickySlaMs: 20_000,
        maxDiscoveryRounds: 2,
        racingTotalTimeoutMs: 30_000,
      })
    ).toThrow("竞速总超时");
  });

  it("accepts a total deadline exactly equal to the configured discovery window", () => {
    expect(() =>
      UpdateSystemSettingsSchema.parse({
        discoverySlaMs: 10_000,
        stickySlaMs: 20_000,
        maxDiscoveryRounds: 2,
        racingTotalTimeoutMs: 40_000,
      })
    ).not.toThrow();
  });

  it("preserves an intentionally shorter Sticky SLA", () => {
    const result = UpdateSystemSettingsSchema.parse({
      discoverySlaMs: 10_000,
      stickySlaMs: 5_000,
      maxDiscoveryRounds: 2,
      racingTotalTimeoutMs: 25_000,
    });
    expect(result.stickySlaMs).toBe(5_000);
  });

  it("allows partial updates so the server can merge them with stored settings", () => {
    expect(UpdateSystemSettingsSchema.parse({ discoveryEnabled: true })).toEqual({
      discoveryEnabled: true,
    });
  });
});
