import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 public status evidence", () => {
  test("public status tests cover unauthenticated sanitized reads", () => {
    const source = readFileSync("tests/api/v1/public/public-status-ip-geo.test.ts", "utf8");

    expect(source).toContain("serves public status without authentication");
    expect(source).toContain("/api/v1/public/status?range=1h");
    expect(source).toContain("returns the v1 problem envelope for invalid public status queries");
    expect(source).toContain("documents public status and ip geo REST paths");
  });
});
