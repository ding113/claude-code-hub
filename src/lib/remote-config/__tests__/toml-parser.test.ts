import { describe, expect, test } from "vitest";
import { parsePricesOverrideToml, parseVendorsToml } from "../toml-parser";

describe("remote-config/toml-parser", () => {
  test("parses vendors.toml with nested endpoints + balance_check", () => {
    const toml = `
[metadata]
version = "2025.12.25"

[[vendors]]
slug = "anthropic"
name = "Anthropic"
category = "official"
website_url = "https://www.anthropic.com"
favicon_url = "https://www.anthropic.com/favicon.ico"
tags = ["claude"]

[[vendors.endpoints]]
name = "Official API"
url = "https://api.anthropic.com"
api_format = "claude"
auth_type = "x-api-key"

[vendors.balance_check]
enabled = true
endpoint = "/v1/usage"
jsonpath = "$.remaining_credits"
interval_seconds = 60
low_threshold_usd = 12.34

[[vendors]]
slug = "openai"
name = "OpenAI"
category = "official"
tags = ["codex", "gpt"]

[[vendors.endpoints]]
name = "Official API"
url = "https://api.openai.com"
api_format = "codex"
auth_type = "bearer"
`;

    const parsed = parseVendorsToml(toml);
    expect(parsed.metadata.version).toBe("2025.12.25");
    expect(parsed.vendors).toHaveLength(2);

    const [anthropic, openai] = parsed.vendors;
    expect(anthropic.slug).toBe("anthropic");
    expect(anthropic.endpoints).toHaveLength(1);
    expect(anthropic.endpoints[0]?.api_format).toBe("claude");
    expect(anthropic.balance_check?.enabled).toBe(true);
    expect(anthropic.balance_check?.jsonpath).toBe("$.remaining_credits");

    expect(openai.slug).toBe("openai");
    expect(openai.endpoints[0]?.url).toBe("https://api.openai.com");
  });

  test("parses prices-override.toml into prices map", () => {
    const toml = `
[metadata]
version = "2025.12.25"

[prices."gpt-4o"]
mode = "chat"
input_cost_per_token = 0.0000025
output_cost_per_token = 0.00001

[prices."claude-3-5-sonnet-20241022"]
mode = "chat"
input_cost_per_token = 0.000003
output_cost_per_token = 0.000015
`;

    const parsed = parsePricesOverrideToml(toml);
    expect(parsed.metadata.version).toBe("2025.12.25");
    expect(Object.keys(parsed.prices)).toEqual(["gpt-4o", "claude-3-5-sonnet-20241022"]);
    expect(parsed.prices["gpt-4o"]?.mode).toBe("chat");
    expect(parsed.prices["gpt-4o"]?.input_cost_per_token).toBeCloseTo(0.0000025);
  });

  test("throws on missing metadata.version", () => {
    expect(() =>
      parseVendorsToml(`
[[vendors]]
slug = "anthropic"
name = "Anthropic"
category = "official"
`)
    ).toThrow(/metadata\.version/i);
  });
});
