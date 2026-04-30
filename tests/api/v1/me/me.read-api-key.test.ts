import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 me API key evidence", () => {
  test("me tests cover scoped read endpoints", () => {
    const source = readFileSync("tests/api/v1/me/me.test.ts", "utf8");

    expect(source).toContain("reads metadata quota and today's stats");
    expect(source).toContain("lists usage logs with offset cursor and full read-only shape");
    expect(source).toContain("/api/v1/me/quota");
    expect(source).toContain("/api/v1/me/ip-geo/8.8.8.8");
  });
});
