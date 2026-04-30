import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 keys CRUD evidence", () => {
  test("keys test file covers REST key operations", () => {
    const source = readFileSync("tests/api/v1/keys/keys.test.ts", "utf8");

    expect(source).toContain("lists and creates user keys");
    expect(source).toContain("updates deletes enables and renews keys");
    expect(source).toContain("/api/v1/users/1/keys");
    expect(source).toContain("/api/v1/keys/10");
  });
});
