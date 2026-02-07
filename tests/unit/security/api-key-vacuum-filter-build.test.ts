import { describe, expect, test } from "vitest";
import { buildVacuumFilterFromKeyStrings } from "@/lib/security/api-key-vacuum-filter";

describe("buildVacuumFilterFromKeyStrings", () => {
  test("应去重并忽略空字符串，且覆盖所有 key", () => {
    const vf = buildVacuumFilterFromKeyStrings({
      keyStrings: ["k1", "k2", "k1", ""],
      fingerprintBits: 32,
      maxKickSteps: 500,
      seed: Buffer.from("unit-test-seed"),
    });

    expect(vf.size()).toBe(2);
    expect(vf.has("k1")).toBe(true);
    expect(vf.has("k2")).toBe(true);
  });
});
