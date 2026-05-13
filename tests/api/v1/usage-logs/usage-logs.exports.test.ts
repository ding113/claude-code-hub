import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 usage logs export evidence", () => {
  test("usage logs tests cover export lifecycle routes", () => {
    const source = readFileSync("tests/api/v1/usage-logs/usage-logs.test.ts", "utf8");

    expect(source).toContain("creates sync and async exports and downloads completed csv");
    expect(source).toContain("/api/v1/usage-logs/exports");
    expect(source).toContain("/api/v1/usage-logs/exports/job-1/download");
    expect(source).toContain("startUsageLogsExportMock");
  });
});
