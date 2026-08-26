import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

function packageManagerInvocation(): { command: string; args: string[] } {
  const packageManager = process.env.npm_execpath;
  if (packageManager) {
    if (/^bunx(?:\.exe)?$/i.test(path.basename(packageManager))) {
      return {
        command: path.join(
          path.dirname(packageManager),
          process.platform === "win32" ? "bun.exe" : "bun"
        ),
        args: ["run", "openapi:check"],
      };
    }
    return /\.[cm]?js$/i.test(packageManager)
      ? { command: process.execPath, args: [packageManager, "run", "openapi:check"] }
      : { command: packageManager, args: ["run", "openapi:check"] };
  }
  if (/^bun(?:\.exe)?$/i.test(path.basename(process.execPath))) {
    return { command: process.execPath, args: ["run", "openapi:check"] };
  }
  return { command: "bun", args: ["run", "openapi:check"] };
}

describe("v1 generated OpenAPI types", () => {
  test("generated type file exists with generated header", () => {
    const filePath = path.join(process.cwd(), "src/lib/api-client/v1/openapi-types.gen.ts");

    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8").startsWith("// AUTO-GENERATED - DO NOT EDIT")).toBe(true);
  });

  test("generated type file is in sync with the current OpenAPI document", () => {
    const invocation = packageManagerInvocation();
    expect(() =>
      execFileSync(invocation.command, invocation.args, {
        cwd: process.cwd(),
        stdio: "pipe",
      })
    ).not.toThrow();
  });
});
