import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { proxyMatcherPattern } from "@/proxy.matcher";

// The Next.js matcher string is intended to behave as a JS regex anchored to
// the full pathname. Compile it that way for the assertions below.
const matcher = new RegExp(`^${proxyMatcherPattern}$`);

describe("proxy matcher", () => {
  describe("paths the proxy MUST skip (regression: matching them forces Next to clone the request body, clamping it to proxyClientMaxBodySize)", () => {
    it.each([
      "/v1/messages",
      "/v1/chat/completions",
      "/v1/responses",
      "/v1/models",
      "/v1", // bare segment also a valid proxy entry
      "/v1beta/messages",
      "/v1beta",
      "/v1beta/v1/foo",
    ])("does not match %s", (pathname) => {
      expect(matcher.test(pathname)).toBe(false);
    });
  });

  describe("look-alike paths that must NOT be excluded (regression: a bare `v1` prefix would over-match, e.g. `/v10`)", () => {
    it.each(["/v10/foo", "/v1foo", "/v1beta-extra", "/version"])("matches %s", (pathname) => {
      expect(matcher.test(pathname)).toBe(true);
    });
  });

  describe("paths the proxy already skipped before this PR", () => {
    it.each([
      "/api/health",
      "/api/admin/database/import",
      "/_next/static/chunks/main.js",
      "/_next/image/anything.png",
      "/favicon.ico",
    ])("does not match %s", (pathname) => {
      expect(matcher.test(pathname)).toBe(false);
    });
  });

  describe("paths the proxy MUST still handle (locale routing + auth gating)", () => {
    it.each([
      "/dashboard",
      "/login",
      "/zh/dashboard",
      "/en/login",
      "/zh/status",
      "/usage-doc",
      "/", // root
    ])("matches %s", (pathname) => {
      expect(matcher.test(pathname)).toBe(true);
    });
  });

  // Drift guard: Next.js's build-time static analyzer requires `config.matcher`
  // entries to be string literals, so `src/proxy.ts` cannot import the pattern
  // from `proxy.matcher.ts`. Instead it inlines a copy. This test fails if the
  // two ever drift — preventing a silent regression where the proxy starts
  // using a different matcher than the one this test file exercises.
  it("inlined matcher in src/proxy.ts stays in sync with src/proxy.matcher.ts", () => {
    const proxyTs = fs.readFileSync(path.join(__dirname, "../../src/proxy.ts"), "utf8");
    const m = proxyTs.match(/matcher:\s*\[\s*"([^"]+)"\s*\]/);
    expect(m, 'could not locate `matcher: ["..."]` literal in src/proxy.ts').not.toBeNull();
    expect(m?.[1]).toBe(proxyMatcherPattern);
  });
});
