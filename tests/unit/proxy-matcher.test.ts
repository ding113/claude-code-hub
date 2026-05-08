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
      "/v1beta/messages", // covered by the `v1` prefix in the negative lookahead
      "/v1beta/v1/foo",
    ])("does not match %s", (pathname) => {
      expect(matcher.test(pathname)).toBe(false);
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
});
