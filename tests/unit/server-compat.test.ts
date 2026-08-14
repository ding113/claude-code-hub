import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { rewriteCompatPath } = require("../../server-compat") as {
  rewriteCompatPath: (pathname: string) => string;
};

describe("server-compat rewriteCompatPath (Node http layer, before Next handler)", () => {
  it("rewrites bare OpenAI paths to /v1/...", () => {
    for (const prefix of [
      "/models",
      "/messages",
      "/chat/completions",
      "/responses",
      "/completions",
      "/embeddings",
      "/props",
      "/_ping",
    ]) {
      expect(rewriteCompatPath(prefix)).toBe(`/v1${prefix}`);
      expect(rewriteCompatPath(`${prefix}/gpt-5.6-luna`)).toBe(
        `/v1${prefix}/gpt-5.6-luna`
      );
    }
  });

  it("rewrites nested /v1/v1beta/... to /v1beta/... stripping the extra /v1", () => {
    expect(rewriteCompatPath("/v1/v1beta")).toBe("/v1beta");
    expect(rewriteCompatPath("/v1/v1beta/models")).toBe("/v1beta/models");
    expect(
      rewriteCompatPath(
        "/v1/v1beta/models/gemini-3.7-flash-high:generateContent"
      )
    ).toBe("/v1beta/models/gemini-3.7-flash-high:generateContent");
  });

  it("leaves /v1 and /v1beta routes untouched", () => {
    for (const pathname of [
      "/v1/models",
      "/v1/chat/completions",
      "/v1/responses",
      "/v1",
      "/v1beta/models",
      "/v1beta",
    ]) {
      expect(rewriteCompatPath(pathname)).toBe(pathname);
    }
  });

  it("leaves web/UI paths untouched", () => {
    for (const pathname of [
      "/",
      "/login",
      "/zh-CN/dashboard",
      "/status",
      "/usage-doc",
      "/api/health",
      "/_next/static/chunks/main.js",
      "/favicon.ico",
      "/v10/foo",
      "/v1foo",
      "/version",
    ]) {
      expect(rewriteCompatPath(pathname)).toBe(pathname);
    }
  });
});
