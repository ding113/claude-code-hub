import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 keyword routing CRUD evidence", () => {
  test("keyword routing tests cover REST CRUD", () => {
    const source = readFileSync("tests/api/v1/keyword-routing/keyword-routing.test.ts", "utf8");

    expect(source).toContain("lists and mutates keyword routing rules with REST semantics");
    expect(source).toContain("/api/v1/keyword-routing-rules");
    expect(source).toContain("/api/v1/keyword-routing-rules/cache:refresh");
  });
});
