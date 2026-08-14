import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { proxyMatcherPattern } from "@/proxy.matcher";

// The Next.js matcher string is intended to behave as a JS regex anchored to
// the full pathname. Compile it that way for the assertions below.
const matcher = new RegExp(`^${proxyMatcherPattern}$`);

describe("proxy matcher", () => {
  describe("paths the proxy MUST handle (API proxy routes, bare OpenAI compat paths)", () => {
    it.each([
      // /v1 + /v1beta must stay IN the matcher: middleware rewrite targets
      // (bare paths → /v1/..., /v1/v1beta/... → /v1beta/...) resolve inside
      // the matcher scope. Next.js 16.3 does not re-route middleware rewrites
      // to matcher-excluded paths (404).
      "/v1/messages",
      "/v1/chat/completions",
      "/v1/responses",
      "/v1/models",
      "/v1", // bare segment also a valid proxy entry
      "/v1beta/messages",
      "/v1beta",
      "/v1beta/v1/foo",
      "/v1/v1beta",
      "/v1/v1beta/models",
      "/v1/v1beta/models/gemini-3.7-flash-high:generateContent",
      // bare OpenAI API paths (base_url without /v1) — rewritten by middleware
      "/models",
      "/models/gpt-5.6-luna",
      "/chat/completions",
      "/responses",
      "/completions",
      "/embeddings",
      "/props",
      "/_ping",
    ])("matches %s", (pathname) => {
      expect(matcher.test(pathname)).toBe(true);
    });
  });

  describe("look-alike paths that must be handled by middleware (no accidental exclusion)", () => {
    it.each(["/v10/foo", "/v1foo", "/v1beta-extra", "/version"])( 
      "matches %s",
      (pathname) => {
        expect(matcher.test(pathname)).toBe(true);
      }
    );
  });

  describe("paths the proxy MUST skip", () => {
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
