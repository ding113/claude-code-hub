import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { v1Keys } from "@/lib/api-client/v1/keys";

const source = readFileSync("src/lib/api-client/v1/actions/users.ts", "utf8");

describe("v1 users client migration surface", () => {
  test("routes user operations through v1 endpoints and stable query keys", () => {
    expect(v1Keys.users.all).toEqual(["v1", "users"]);
    expect(v1Keys.users.detail(7)).toEqual(["v1", "users", "detail", 7]);
    expect(source).toContain('"/api/v1/users"');
    expect(source).toContain('"/api/v1/users:batchUpdate"');
    expect(source).toContain("`/api/v1/users/${userId}`");
    expect(source).toContain("`/api/v1/users/${userId}/limits:reset`");
  });
});
