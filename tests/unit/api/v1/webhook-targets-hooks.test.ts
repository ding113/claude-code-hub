import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { v1Keys } from "@/lib/api-client/v1/keys";

const source = readFileSync("src/lib/api-client/v1/webhook-targets/hooks.ts", "utf8");

describe("v1 webhook target hooks", () => {
  test("use REST endpoints and invalidate the resource key", () => {
    expect(v1Keys.webhookTargets.all).toEqual(["v1", "webhook-targets"]);
    expect(source).toContain('"/api/v1/webhook-targets"');
    expect(source).toContain("`/api/v1/webhook-targets/${id}`");
    expect(source).toContain("`/api/v1/webhook-targets/${id}:test`");
    expect(source).toContain("invalidateQueries({ queryKey: v1Keys.webhookTargets.all })");
  });
});
