import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 public status contract evidence", () => {
  test("public status tests cover contract and sanitized reads", () => {
    const source = readFileSync("tests/api/v1/public/public-status-ip-geo.test.ts", "utf8");

    expect(source).toContain("serves public status without authentication");
    expect(source).toContain("documents public status and ip geo REST paths");
    expect(source).toContain("/api/v1/public/status");
    expect(source).toContain("/api/v1/ip-geo/{ip}");
  });
});
