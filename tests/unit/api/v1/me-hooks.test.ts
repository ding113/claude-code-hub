import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { v1Keys } from "@/lib/api-client/v1/keys";

const source = readFileSync("src/lib/api-client/v1/me/hooks.ts", "utf8");

describe("v1 self-service hooks", () => {
  test("route self-service reads through scoped v1 endpoints", () => {
    expect(v1Keys.me.quota()).toEqual(["v1", "me", "quota"]);
    expect(v1Keys.me.ipGeo("8.8.8.8", "zh-CN")).toEqual(["v1", "me", "ip-geo", "8.8.8.8", "zh-CN"]);
    expect(source).toContain('"/api/v1/me/quota"');
    expect(source).toContain("`/api/v1/me/usage-logs${toQuery(params)}`");
    expect(source).toContain("`/api/v1/me/ip-geo/${encodeURIComponent(ip)}");
  });
});
