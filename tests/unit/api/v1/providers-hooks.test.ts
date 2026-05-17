import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { v1Keys } from "@/lib/api-client/v1/keys";

const source = readFileSync("src/lib/api-client/v1/providers/hooks.ts", "utf8");

describe("v1 provider hooks", () => {
  test("searches providers through v1 and invalidates provider keys", () => {
    expect(v1Keys.providers.list({ q: "cubence" })).toEqual([
      "v1",
      "providers",
      "list",
      { q: "cubence" },
    ]);
    expect(source).toContain("apiClient.get<ProviderListResponse>(`/api/v1/providers");
    expect(source).toContain('search.set("q", params.q)');
    expect(source).toContain("invalidateQueries({ queryKey: v1Keys.providers.all })");
  });
});
