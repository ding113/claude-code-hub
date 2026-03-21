import { describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

const undiciRequestMock = vi.fn(async () => {
  return {
    statusCode: 200,
    body: {
      json: async () => ({
        models: [{ name: "models/gemini-1.5-pro", displayName: "Gemini 1.5 Pro" }],
      }),
      text: async () => "",
    },
  };
});

vi.mock("undici", () => {
  return {
    request: undiciRequestMock,
  };
});

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

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn().mockResolvedValue("UTC"),
}));

vi.mock("@/lib/utils/provider-schedule", () => ({
  isProviderActiveNow: vi.fn().mockReturnValue(true),
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  checkProviderGroupMatch: vi.fn().mockReturnValue(true),
}));

vi.mock("@/repository/provider", () => ({
  findAllProviders: vi.fn().mockResolvedValue([]),
}));

describe("handleAvailableModels - Gemini key 传参", () => {
  test("Gemini 上游请求不应在 URL query 携带 key，应使用 x-goog-api-key 头", async () => {
    const geminiProvider = {
      id: 1,
      name: "gemini",
      providerType: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta",
      key: "upstream-api-key",
      preserveClientIp: false,
      allowedModels: null,
      isEnabled: true,
      activeTimeStart: null,
      activeTimeEnd: null,
      groupTag: null,
    } as unknown as Provider;

    const { findAllProviders } = await import("@/repository/provider");
    vi.mocked(findAllProviders).mockResolvedValue([geminiProvider]);

    const { handleAvailableModels } = await import("@/app/v1/_lib/models/available-models");

    const c = {
      req: {
        path: "/v1/models",
        header: (name: string) => {
          if (name.toLowerCase() === "x-goog-api-key") return "user-api-key";
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

    await handleAvailableModels(c);

    expect(undiciRequestMock).toHaveBeenCalledTimes(1);

    const [url, options] = undiciRequestMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("key=");
    expect(options?.headers?.["x-goog-api-key"]).toBe("upstream-api-key");
  });
});
