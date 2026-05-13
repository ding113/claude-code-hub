import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 IP geo evidence", () => {
  test("public tests cover read-tier IP geo lookup", () => {
    const source = readFileSync("tests/api/v1/public/public-status-ip-geo.test.ts", "utf8");

    expect(source).toContain("looks up ip geolocation as a read endpoint");
    expect(source).toContain("/api/v1/ip-geo/127.0.0.1?lang=en");
    expect(source).toContain("returns problem+json when ip geo is disabled");
  });
});
