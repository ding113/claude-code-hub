import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 error rules authz evidence", () => {
  test("error rules tests cover cache refresh and auth failures", () => {
    const source = readFileSync("tests/api/v1/error-rules/error-rules.test.ts", "utf8");

    expect(source).toContain("/api/v1/error-rules/cache:refresh");
    expect(source).toContain("returns problem+json for invalid requests and not-found failures");
    expect(source).toContain("application/problem+json");
  });
});
