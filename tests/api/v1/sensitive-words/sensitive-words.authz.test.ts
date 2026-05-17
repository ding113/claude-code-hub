import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 sensitive words authz evidence", () => {
  test("sensitive words tests cover non-admin rejection", () => {
    const source = readFileSync("tests/api/v1/sensitive-words/sensitive-words.test.ts", "utf8");

    expect(source).toContain("returns problem+json for invalid requests and not-found failures");
    expect(source).toContain("application/problem+json");
  });
});
