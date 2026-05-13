import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = readFileSync("src/lib/api-client/v1/actions/keys.ts", "utf8");

describe("v1 keys client migration surface", () => {
  test("routes key operations through v1 endpoints", () => {
    expect(source).toContain("`/api/v1/users/${userId}/keys`");
    expect(source).toContain("`/api/v1/keys/${keyId}`");
    expect(source).toContain("`/api/v1/keys/${keyId}/limits:reset`");
    expect(source).toContain("`/api/v1/keys/${keyId}:enable`");
    expect(source).toContain('"/api/v1/keys:batchUpdate"');
  });
});
