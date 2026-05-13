import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { v1Keys } from "@/lib/api-client/v1/keys";

const source = readFileSync("src/lib/api-client/v1/providers/hooks.ts", "utf8");

describe("v1 provider key reveal hook contract", () => {
  test("keeps key reveal explicit and no-store", () => {
    expect(v1Keys.providers.keyReveal(12)).toEqual(["v1", "providers", "keyReveal", 12]);
    expect(source).toContain("export function revealProviderKey");
    expect(source).toContain("`/api/v1/providers/${id}/key:reveal`");
    expect(source).toContain('cache: "no-store"');
    expect(source).not.toContain("key:reveal`, input");
  });
});
