import { describe, expect, test } from "vitest";
import { EnvSchema } from "@/lib/config/env.schema";

describe("EnvSchema - STREAM_GATE_MODE", () => {
  test("defaults to enforce when unset", () => {
    const env = EnvSchema.parse({});
    expect(env.STREAM_GATE_MODE).toBe("enforce");
    expect(env.STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP).toBe(256 * 1024 * 1024);
  });

  test.each(["off", "shadow", "enforce"] as const)("preserves an explicit %s mode", (mode) => {
    expect(EnvSchema.parse({ STREAM_GATE_MODE: mode }).STREAM_GATE_MODE).toBe(mode);
  });

  test("requires the shared budget to cover raw and decoded echo-exempt prefixes", () => {
    expect(() =>
      EnvSchema.parse({
        STREAM_GATE_PREBUFFER_BYTE_CAP: String(1024 * 1024),
        STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP: String(4 * 1024 * 1024 - 1),
      })
    ).toThrow();
  });
});
