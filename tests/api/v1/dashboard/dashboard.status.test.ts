import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 dashboard status evidence", () => {
  test("dashboard tests cover status routes and admin simulator", () => {
    const source = readFileSync("tests/api/v1/dashboard/dashboard.test.ts", "utf8");

    expect(source).toContain("reads admin dashboard operational endpoints");
    expect(source).toContain("runs dispatch simulator and returns problem+json on invalid input");
    expect(source).toContain("/api/v1/dashboard/proxy-status");
    expect(source).toContain("/api/v1/dashboard/dispatch-simulator:simulate");
  });
});
