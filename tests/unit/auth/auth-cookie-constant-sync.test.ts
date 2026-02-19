import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("auth cookie constant sync", () => {
  it("keeps AUTH_COOKIE_NAME stable", () => {
    expect(AUTH_COOKIE_NAME).toBe("auth-token");
  });

  it("removes hardcoded auth-token cookie literals from core auth layers", () => {
    const proxySource = readSource("src/proxy.ts");
    const actionAdapterSource = readSource("src/lib/api/action-adapter-openapi.ts");

    expect(proxySource).not.toMatch(/["']auth-token["']/);
    expect(actionAdapterSource).not.toMatch(/["']auth-token["']/);
    expect(proxySource).toContain("AUTH_COOKIE_NAME");
    expect(actionAdapterSource).toContain("AUTH_COOKIE_NAME");
  });
});
