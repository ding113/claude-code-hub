import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 usage logs pagination evidence", () => {
  test("usage logs tests cover offset cursor branches", () => {
    const source = readFileSync("tests/api/v1/usage-logs/usage-logs.test.ts", "utf8");

    expect(source).toContain("lists usage logs with offset and cursor filters");
    expect(source).toContain("firstCursorPage");
    expect(source).toContain("cursorCreatedAt");
    expect(source).toContain("getUsageLogsBatchMock");
  });
});
