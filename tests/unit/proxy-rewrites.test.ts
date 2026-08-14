import { describe, expect, it } from "vitest";
import {
  compatRewrites,
  API_PROXY_PATH,
  GEMINI_PROXY_PATH,
} from "@/proxy.rewrites";

function ruleFor(rules: ReturnType<typeof compatRewrites>, source: string) {
  return rules.find((r) => r.source === source);
}

describe("proxy compat rewrites (next.config rewrites, server-side transparent)", () => {
  const rules = compatRewrites();

  it("maps bare OpenAI paths to /v1/...", () => {
    for (const prefix of [
      "/models",
      "/chat/completions",
      "/responses",
      "/completions",
      "/embeddings",
      "/props",
      "/_ping",
    ]) {
      const exact = ruleFor(rules, prefix);
      expect(exact, `${prefix} exact rule`).toBeDefined();
      expect(exact!.destination).toBe(`${API_PROXY_PATH}${prefix}`);

      const wildcard = ruleFor(rules, `${prefix}/:path*`);
      expect(wildcard, `${prefix} wildcard rule`).toBeDefined();
      expect(wildcard!.destination).toBe(`${API_PROXY_PATH}${prefix}/:path*`);
    }
  });

  it("maps nested /v1/v1beta/... to /v1beta/... stripping the extra /v1", () => {
    const exact = ruleFor(rules, "/v1/v1beta");
    expect(exact).toBeDefined();
    expect(exact!.destination).toBe(GEMINI_PROXY_PATH);

    const wildcard = ruleFor(rules, "/v1/v1beta/:path*");
    expect(wildcard).toBeDefined();
    expect(wildcard!.destination).toBe(`${GEMINI_PROXY_PATH}/:path*`);
  });

  it("orders nested /v1/v1beta rules before bare-path rules (no conflict, but keeps intent explicit)", () => {
    // /v1/v1beta and bare prefixes never overlap; the ordering guard is just
    // documentation that the Gemini SDK rewrite must not be shadowed.
    const v1betaIndex = rules.findIndex((r) => r.source.startsWith("/v1/v1beta"));
    const bareIndex = rules.findIndex((r) => r.source === "/models");
    expect(v1betaIndex).toBeGreaterThanOrEqual(0);
    expect(v1betaIndex).toBeLessThan(bareIndex);
  });
});
