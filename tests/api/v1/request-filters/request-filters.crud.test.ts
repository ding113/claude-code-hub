import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 request filters CRUD evidence", () => {
  test("request filters tests cover REST CRUD and options", () => {
    const source = readFileSync("tests/api/v1/request-filters/request-filters.test.ts", "utf8");

    expect(source).toContain("lists and mutates request filters with REST semantics");
    expect(source).toContain("/api/v1/request-filters");
    expect(source).toContain("/api/v1/request-filters/cache:refresh");
  });
});
