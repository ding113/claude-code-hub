import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 provider search evidence", () => {
  test("provider read tests cover search and hidden provider filtering", () => {
    const source = readFileSync("tests/api/v1/providers/providers.read.test.ts", "utf8");

    expect(source).toContain("searches providers and filters hidden provider types");
    expect(source).toContain("/api/v1/providers?q=anthropic");
    expect(source).toContain("claude-auth");
    expect(source).toContain('not.toContain("claude-auth")');
  });
});
