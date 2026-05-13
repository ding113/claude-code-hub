import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("v1 provider key reveal evidence", () => {
  test("provider read tests cover explicit key reveal and no-store", () => {
    const source = readFileSync("tests/api/v1/providers/providers.read.test.ts", "utf8");

    expect(source).toContain("reveals the real provider key only for visible providers");
    expect(source).toContain("/api/v1/providers/1/key:reveal");
    expect(source).toContain("Cache-Control");
    expect(source).toContain("no-store");
    expect(source).toContain("getUnmaskedProviderKeyMock");
  });
});
