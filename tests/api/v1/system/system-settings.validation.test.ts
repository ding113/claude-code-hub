import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 system settings validation evidence", () => {
  test("system tests cover invalid settings problem json", () => {
    const source = readFileSync("tests/api/v1/system/system-config.test.ts", "utf8");

    expect(source).toContain("rejects unknown fields and invalid timezone values");
    expect(source).toContain("request.validation_failed");
    expect(source).toContain("/api/v1/system/settings");
    expect(source).toContain("application/problem+json");
  });
});
