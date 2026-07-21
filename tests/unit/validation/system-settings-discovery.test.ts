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

  it("requires at least one fallback slot in addition to the normal lane", () => {
    const result = UpdateSystemSettingsSchema.safeParse({ discoveryConcurrency: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("DISCOVERY_SETTINGS_INVALID");
    }
  });

  it("uses a stable error code when a Discovery value exceeds its supported range", () => {
    const result = UpdateSystemSettingsSchema.safeParse({ stickyTimeoutCooldownMs: 86_400_001 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("DISCOVERY_SETTINGS_INVALID");
    }
  });

  it("rejects a total deadline shorter than the configured discovery window", () => {
    expect(() =>
      UpdateSystemSettingsSchema.parse({
        discoverySlaMs: 10_000,
        stickySlaMs: 20_000,
        maxDiscoveryRounds: 2,
        racingTotalTimeoutMs: 30_000,
      })
    ).toThrow("DISCOVERY_WINDOW_INVALID");
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
