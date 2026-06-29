import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlmMcpClient } from "@/lib/mcp/glm-client";
import { McpAuthError, McpRequestError } from "@/lib/mcp/types";

describe("GlmMcpClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("maps documented auth error payloads to McpAuthError", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: {
        get: (name: string) => (name === "Trace-Id" ? "trace-auth" : null),
      },
      json: async () => ({
        error: {
          code: "1001",
          message: "Header 中未收到 Authentication 参数，无法进行身份验证",
        },
      }),
    });

    const client = new GlmMcpClient({ baseUrl: "https://glm.example.com", apiKey: "test-key" });

    await expect(
      client.analyzeImage("https://example.com/a.png", "describe")
    ).rejects.toMatchObject({
      name: "McpAuthError",
      traceId: "trace-auth",
    });
  });

  it("maps documented business error payloads to McpRequestError", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: {
        get: () => null,
      },
      json: async () => ({
        error: {
          code: "1301",
          message: "请求频率超限",
        },
      }),
    });

    const client = new GlmMcpClient({ baseUrl: "https://glm.example.com", apiKey: "test-key" });

    await expect(
      client.analyzeVideo("https://example.com/a.mp4", "summarize")
    ).rejects.toMatchObject({
      name: "McpRequestError",
      statusCode: 1301,
    });
  });

  it("falls back to HTTP status when non-2xx body is not JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: {
        get: () => null,
      },
      json: async () => {
        throw new Error("invalid json");
      },
    });

    const client = new GlmMcpClient({ baseUrl: "https://glm.example.com", apiKey: "test-key" });

    await expect(client.analyzeImage("https://example.com/a.png", "describe")).rejects.toEqual(
      expect.objectContaining({
        name: "McpRequestError",
        statusCode: 500,
      })
    );
  });
});
