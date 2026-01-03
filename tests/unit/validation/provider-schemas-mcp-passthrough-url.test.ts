import { describe, expect, test } from "vitest";
import { CreateProviderSchema, UpdateProviderSchema } from "@/lib/validation/schemas";

describe("Provider Schemas: mcp_passthrough_url", () => {
  test("CreateProviderSchema 允许使用内网 MCP 透传 URL", () => {
    const parsed = CreateProviderSchema.parse({
      name: "test-provider",
      url: "https://example.com",
      key: "sk-test",
      mcp_passthrough_type: "custom",
      mcp_passthrough_url: "http://127.0.0.1:8080/mcp",
    });

    expect(parsed.mcp_passthrough_url).toBe("http://127.0.0.1:8080/mcp");
  });

  test("UpdateProviderSchema 允许使用内网 MCP 透传 URL", () => {
    const parsed = UpdateProviderSchema.parse({
      mcp_passthrough_type: "custom",
      mcp_passthrough_url: "http://localhost:8080/mcp",
    });

    expect(parsed.mcp_passthrough_url).toBe("http://localhost:8080/mcp");
  });

  test("仍然拒绝非法的 MCP 透传 URL", () => {
    expect(() =>
      CreateProviderSchema.parse({
        name: "test-provider",
        url: "https://example.com",
        key: "sk-test",
        mcp_passthrough_type: "custom",
        mcp_passthrough_url: "not a url",
      })
    ).toThrow();
  });
});
