import { describe, expect, test } from "vitest";
import { EnvSchema } from "@/lib/config/env.schema";

describe("EnvSchema - STREAM_GATE_MODE", () => {
  test("defaults to enforce when unset", () => {
    expect(EnvSchema.parse({}).STREAM_GATE_MODE).toBe("enforce");
  });

  test.each(["off", "shadow", "enforce"] as const)("preserves an explicit %s mode", (mode) => {
    expect(EnvSchema.parse({ STREAM_GATE_MODE: mode }).STREAM_GATE_MODE).toBe(mode);
  });
});
