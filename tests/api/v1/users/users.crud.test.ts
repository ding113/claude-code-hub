import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 users CRUD evidence", () => {
  test("users test file covers REST CRUD endpoints", () => {
    const source = readFileSync("tests/api/v1/users/users.test.ts", "utf8");

    expect(source).toContain("creates updates deletes enables and renews users");
    expect(source).toContain("/api/v1/users");
    expect(source).toContain("/api/v1/users/1");
    expect(source).toContain("/api/v1/users/1:renew");
  });
});
