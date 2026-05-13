import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("v1 generated OpenAPI types", () => {
  test("generated type file exists with generated header", () => {
    const filePath = path.join(process.cwd(), "src/lib/api-client/v1/openapi-types.gen.ts");

    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8").startsWith("// AUTO-GENERATED - DO NOT EDIT")).toBe(true);
  });

  test("generated type file is in sync with the current OpenAPI document", () => {
    expect(() =>
      execFileSync("bun", ["scripts/generate-v1-types.ts", "--check"], {
        cwd: process.cwd(),
        stdio: "pipe",
      })
    ).not.toThrow();
  });
});
