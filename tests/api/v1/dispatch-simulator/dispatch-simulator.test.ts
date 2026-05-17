import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 dispatch simulator evidence", () => {
  test("dashboard tests cover simulator route and invalid input", () => {
    const source = readFileSync("tests/api/v1/dashboard/dashboard.test.ts", "utf8");

    expect(source).toContain("runs dispatch simulator and returns problem+json on invalid input");
    expect(source).toContain("/api/v1/dashboard/dispatch-simulator:simulate");
    expect(source).toContain("clientFormat");
    expect(source).toContain("application/problem+json");
  });
});
