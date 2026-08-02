import { describe, expect, test } from "vitest";
import { EnvSchema } from "@/lib/config/env.schema";

describe("EnvSchema - ENABLE_REQUEST_REPLAY", () => {
  test("defaults to enabled when unset", () => {
    expect(EnvSchema.parse({}).ENABLE_REQUEST_REPLAY).toBe(true);
  });

  test.each([
    ["true", true],
    ["false", false],
  ] as const)("preserves an explicit %s value", (value, expected) => {
    expect(EnvSchema.parse({ ENABLE_REQUEST_REPLAY: value }).ENABLE_REQUEST_REPLAY).toBe(expected);
  });
});
