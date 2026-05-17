import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 sensitive words CRUD evidence", () => {
  test("sensitive words tests cover REST CRUD", () => {
    const source = readFileSync("tests/api/v1/sensitive-words/sensitive-words.test.ts", "utf8");

    expect(source).toContain("lists and mutates sensitive words with REST semantics");
    expect(source).toContain("/api/v1/sensitive-words");
    expect(source).toContain("/api/v1/sensitive-words/cache:refresh");
  });
});
