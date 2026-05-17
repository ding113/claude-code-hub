import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { v1Keys } from "@/lib/api-client/v1/keys";

const source = readFileSync("src/lib/api-client/v1/usage-logs/hooks.ts", "utf8");

describe("v1 usage log hooks", () => {
  test("use cursor-capable keys and export endpoints", () => {
    expect(v1Keys.usageLogs.list({ limit: 15 })).toEqual([
      "v1",
      "usage-logs",
      "list",
      { limit: 15 },
    ]);
    expect(source).toContain("`/api/v1/usage-logs${toQuery(params)}`");
    expect(source).toContain('"/api/v1/usage-logs/exports"');
    expect(source).toContain("`/api/v1/usage-logs/exports/${jobId}`");
  });
});
