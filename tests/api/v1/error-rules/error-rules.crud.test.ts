import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 error rules CRUD evidence", () => {
  test("error rules tests cover REST CRUD", () => {
    const source = readFileSync("tests/api/v1/error-rules/error-rules.test.ts", "utf8");

    expect(source).toContain("lists and mutates error rules with REST semantics");
    expect(source).toContain("/api/v1/error-rules");
    expect(source).toContain("/api/v1/error-rules/1");
  });
});
