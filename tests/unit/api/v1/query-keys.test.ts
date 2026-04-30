import { describe, expect, test } from "vitest";
import { v1Keys } from "@/lib/api-client/v1/keys";

describe("v1 query keys", () => {
  test("creates stable resource key prefixes", () => {
    expect(v1Keys.users.all).toEqual(["v1", "users"]);
    expect(v1Keys.users.detail(1)).toEqual(["v1", "users", "detail", 1]);
    expect(v1Keys.providers.keyReveal(2)).toEqual(["v1", "providers", "keyReveal", 2]);
  });
});
