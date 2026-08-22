import { describe, expect, it } from "vitest";
import { EnvSchema } from "@/lib/config/env.schema";

describe("EnvSchema - detached stream budget", () => {
  it("uses bounded defaults", () => {
    const env = EnvSchema.parse({});
    expect(env.DETACHED_STREAM_MAX_CONCURRENCY).toBe(64);
    expect(env.DETACHED_STREAM_BUDGET_BYTES).toBe(64 * 1024 * 1024);
    expect(env.DETACHED_STREAM_METERING_RESERVE_BYTES).toBe(16 * 1024 * 1024);
  });

  it("parses explicit budget limits", () => {
    const env = EnvSchema.parse({
      DETACHED_STREAM_MAX_CONCURRENCY: "8",
      DETACHED_STREAM_BUDGET_BYTES: String(4 * 1024 * 1024),
      DETACHED_STREAM_METERING_RESERVE_BYTES: String(128 * 1024),
    });
    expect(env.DETACHED_STREAM_MAX_CONCURRENCY).toBe(8);
    expect(env.DETACHED_STREAM_BUDGET_BYTES).toBe(4 * 1024 * 1024);
    expect(env.DETACHED_STREAM_METERING_RESERVE_BYTES).toBe(128 * 1024);
  });

  it("rejects a budget smaller than one metering reservation", () => {
    expect(() =>
      EnvSchema.parse({
        DETACHED_STREAM_BUDGET_BYTES: String(3 * 1024 * 1024 + 64 * 1024 - 1),
      })
    ).toThrow();
  });

  it("rejects a metering reserve larger than the total budget", () => {
    expect(() =>
      EnvSchema.parse({
        DETACHED_STREAM_BUDGET_BYTES: String(4 * 1024 * 1024),
        DETACHED_STREAM_METERING_RESERVE_BYTES: String(5 * 1024 * 1024),
      })
    ).toThrow();
  });

  it("allows a metering reserve equal to the total budget", () => {
    const budget = 4 * 1024 * 1024;
    expect(
      EnvSchema.parse({
        DETACHED_STREAM_BUDGET_BYTES: String(budget),
        DETACHED_STREAM_METERING_RESERVE_BYTES: String(budget),
      }).DETACHED_STREAM_METERING_RESERVE_BYTES
    ).toBe(budget);
  });
});
