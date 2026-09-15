import { describe, expect, it } from "vitest";
import { buildProviderTestHeaders } from "@/lib/provider-testing/test-service";
import type { ProviderTestConfig } from "@/lib/provider-testing/types";

function createConfig(overrides: Partial<ProviderTestConfig> = {}): ProviderTestConfig {
  return {
    providerUrl: "https://opencode.ai/zen/go/v1",
    apiKey: "test-key",
    providerType: "openai-compatible",
    ...overrides,
  };
}

describe("buildProviderTestHeaders", () => {
  it("adds a session header for opencode connectivity tests", () => {
    const headers = buildProviderTestHeaders(createConfig());

    expect(headers["x-opencode-session"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not duplicate a custom session header written with different casing", () => {
    const headers = buildProviderTestHeaders(
      createConfig({ customHeaders: { "X-OpenCode-Session": "ses_custom" } })
    );

    const sessionKeys = Object.keys(headers).filter(
      (name) => name.toLowerCase() === "x-opencode-session"
    );
    expect(sessionKeys).toEqual(["X-OpenCode-Session"]);
    expect(headers["X-OpenCode-Session"]).toBe("ses_custom");
  });

  it("leaves non-opencode providers untouched", () => {
    const headers = buildProviderTestHeaders(
      createConfig({ providerUrl: "https://api.openai.com/v1" })
    );

    expect(Object.keys(headers).some((name) => name.toLowerCase() === "x-opencode-session")).toBe(
      false
    );
  });
});
