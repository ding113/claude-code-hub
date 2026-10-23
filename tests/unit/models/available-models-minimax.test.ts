import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types/provider";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  providers: vi.fn(),
}));
vi.mock("undici", () => ({ request: mocks.request }));
vi.mock("@/app/v1/_lib/proxy/auth-guard", () => ({
  extractApiKeyFromHeaders: () => "fixture-hub-key",
}));
vi.mock("@/repository/provider", () => ({ findAllProviders: mocks.providers }));
vi.mock("@/repository/key", () => ({
  resolveApiKeyAuthOutcome: async () => ({
    ok: true,
    user: { id: 1, providerGroup: null, isEnabled: true, expiresAt: null },
    key: { providerGroup: null },
  }),
}));
vi.mock("@/lib/proxy-agent", () => ({ createProxyAgentForProvider: () => null }));
vi.mock("@/lib/utils/timezone", () => ({ resolveSystemTimezone: async () => "UTC" }));
vi.mock("@/lib/utils/provider-schedule", () => ({ isProviderActiveNow: () => true }));
vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({ checkProviderGroupMatch: () => true }));

import { handleAvailableModels } from "@/app/v1/_lib/models/available-models";

describe("MiniMax /v1/models discovery", () => {
  it.each([false, true])("preserves explicit saved model rules: %s", async (saved) => {
    mocks.request.mockReset();
    const names = [
      "MiniMax-M2.7",
      "MiniMax-M3",
      "MiniMax-M3.1-Flash",
      "MiniMax-H3",
      "custom-alias",
    ];
    mocks.providers.mockResolvedValue([
      {
        id: 1,
        name: "MiniMax",
        providerType: "openai-compatible",
        url: "https://api.minimax.io/v1",
        key: "fixture-provider-key",
        isEnabled: true,
        preserveClientIp: false,
        allowedModels: saved ? names : null,
        activeTimeStart: null,
        activeTimeEnd: null,
        groupTag: null,
      } as unknown as Provider,
    ]);
    mocks.request.mockResolvedValue({
      statusCode: 200,
      body: {
        json: async () => ({ data: names.map((id) => ({ id })) }),
        text: async () => "",
      },
    });
    const response = await handleAvailableModels({
      req: {
        path: "/v1/models",
        header: (name: string) => (name === "authorization" ? "Bearer fixture-hub-key" : undefined),
        query: () => undefined,
      },
      json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    } as unknown as Context);
    expect(response.status).toBe(200);
    const ids = (await response.json()).data.map((item: { id: string }) => item.id);
    expect(ids.slice(0, 2)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    expect(ids.includes("MiniMax-M2.7")).toBe(saved);
    expect(ids).toContain("MiniMax-H3");
    expect(ids).toContain("custom-alias");
    expect(mocks.request).toHaveBeenCalledTimes(saved ? 0 : 1);
    if (!saved) {
      expect(String(mocks.request.mock.calls[0][0])).toBe("https://api.minimax.io/v1/models");
      expect(mocks.request.mock.calls[0][1].headers.Authorization).toBe(
        "Bearer fixture-provider-key"
      );
    }
  });
});
