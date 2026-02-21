import { describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

vi.mock("@/repository/key", () => {
  return {
    validateApiKeyAndGetUser: vi.fn(async () => ({
      user: { id: 1, providerGroup: null, isEnabled: true, expiresAt: null },
      key: { providerGroup: null, name: "test-key" },
    })),
  };
});

vi.mock("@/lib/proxy-agent", () => {
  return {
    createProxyAgentForProvider: vi.fn(() => null),
  };
});

describe("handleAvailableModels - include modelRedirects keys", () => {
  test("anthropic response includes redirect source model (key)", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");
    const { handleAvailableModels } = await import("@/app/v1/_lib/models/available-models");

    const claudeProvider = {
      id: 1,
      name: "claude",
      providerType: "claude",
      url: "https://api.anthropic.com",
      key: "upstream-api-key",
      preserveClientIp: false,
      allowedModels: ["claude-opus-4-6-think"],
      modelRedirects: { "claude-opus-4-6": "claude-opus-4-6-think" },
    } as unknown as Provider;

    vi.spyOn(ProxyProviderResolver, "selectProviderByType").mockImplementation(
      async (_authState, providerType) => {
        if (providerType === "claude") {
          return { provider: claudeProvider, context: {} as any };
        }
        return { provider: null, context: {} as any };
      }
    );

    const c = {
      req: {
        path: "/v1/models",
        header: (name: string) => {
          const key = name.toLowerCase();
          if (key === "x-api-key") return "user-api-key";
          if (key === "anthropic-version") return "2023-06-01";
          return undefined;
        },
        query: () => undefined,
      },
      json: (body: unknown, status?: number) => {
        return new Response(JSON.stringify(body), {
          status: status ?? 200,
          headers: { "content-type": "application/json" },
        });
      },
    } as any;

    const res = await handleAvailableModels(c);
    const body = (await res.json()) as any;
    const ids = (body?.data ?? []).map((m: any) => m.id);

    expect(ids).toContain("claude-opus-4-6");
    expect(ids).toContain("claude-opus-4-6-think");
  });

  test("openai response does not include claude-* redirect keys on non-claude providers", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");
    const { handleAvailableModels } = await import("@/app/v1/_lib/models/available-models");

    const openaiProvider = {
      id: 2,
      name: "openai-compatible",
      providerType: "openai-compatible",
      url: "https://api.example.com",
      key: "upstream-api-key",
      preserveClientIp: false,
      allowedModels: ["gpt-4o"],
      modelRedirects: { "claude-test": "gpt-4o" },
    } as unknown as Provider;

    vi.spyOn(ProxyProviderResolver, "selectProviderByType").mockImplementation(
      async (_authState, providerType) => {
        if (providerType === "openai-compatible") {
          return { provider: openaiProvider, context: {} as any };
        }
        return { provider: null, context: {} as any };
      }
    );

    const c = {
      req: {
        path: "/v1/models",
        header: (name: string) => {
          const key = name.toLowerCase();
          if (key === "x-api-key") return "user-api-key";
          return undefined;
        },
        query: () => undefined,
      },
      json: (body: unknown, status?: number) => {
        return new Response(JSON.stringify(body), {
          status: status ?? 200,
          headers: { "content-type": "application/json" },
        });
      },
    } as any;

    const res = await handleAvailableModels(c);
    const body = (await res.json()) as any;
    const ids = (body?.data ?? []).map((m: any) => m.id);

    expect(ids).toContain("gpt-4o");
    expect(ids).not.toContain("claude-test");
  });
});
