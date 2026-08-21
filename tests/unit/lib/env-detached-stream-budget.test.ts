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
      DETACHED_STREAM_BUDGET_BYTES: String(512 * 1024),
      DETACHED_STREAM_METERING_RESERVE_BYTES: String(128 * 1024),
    });
    expect(env.DETACHED_STREAM_MAX_CONCURRENCY).toBe(8);
    expect(env.DETACHED_STREAM_BUDGET_BYTES).toBe(512 * 1024);
    expect(env.DETACHED_STREAM_METERING_RESERVE_BYTES).toBe(128 * 1024);
  });

  it("rejects a budget smaller than one metering reservation", () => {
    expect(() =>
      EnvSchema.parse({ DETACHED_STREAM_BUDGET_BYTES: String(64 * 1024 - 1) })
    ).toThrow();
  });
});
