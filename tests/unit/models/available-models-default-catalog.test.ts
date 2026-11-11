/**
 * Default /v1/models catalog scope.
 *
 * A request that only authenticates must list every provider type the key can
 * access. Explicit format, protocol headers, grouping, enablement, schedule,
 * and the Codex CLI manifest fallback stay scoped.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider, ProviderType } from "@/types/provider";

vi.mock("@/repository/key", () => ({
  resolveApiKeyAuthOutcome: vi.fn(),
}));

vi.mock("@/repository/provider", () => ({
  findAllProviders: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/proxy-agent", () => ({
  createProxyAgentForProvider: vi.fn(),
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn().mockResolvedValue("UTC"),
}));

vi.mock("@/lib/utils/provider-schedule", () => ({
  isProviderActiveNow: vi.fn().mockReturnValue(true),
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", async () => {
  const { PROVIDER_GROUP } = await import("@/lib/constants/provider.constants");
  const { parseProviderGroups, resolveProviderGroupsWithDefault } = await import(
    "@/lib/utils/provider-group"
  );

  return {
    checkProviderGroupMatch: (providerGroupTag: string | null, userGroups: string): boolean => {
      const groups = parseProviderGroups(userGroups);
      if (groups.includes(PROVIDER_GROUP.ALL)) {
        return true;
      }
      const providerTags = resolveProviderGroupsWithDefault(providerGroupTag);
      return providerTags.some((tag) => groups.includes(tag));
    },
  };
});

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn().mockResolvedValue("en"),
}));

import { handleAvailableModels } from "@/app/v1/_lib/models/available-models";
import { isProviderActiveNow } from "@/lib/utils/provider-schedule";
import { resolveApiKeyAuthOutcome } from "@/repository/key";
import { findAllProviders } from "@/repository/provider";

function createApp() {
  const app = new Hono();
  app.get("/v1/models", handleAvailableModels);
  app.get("/v1beta/models", handleAvailableModels);
  return app;
}

function makeProvider(
  providerType: ProviderType,
  modelId: string,
  overrides: Partial<Provider> = {}
): Provider {
  return {
    id: modelId.length,
    name: providerType,
    providerType,
    url: "https://example.test",
    key: "upstream-key",
    isEnabled: true,
    allowedModels: [modelId],
    groupTag: null,
    activeTimeStart: null,
    activeTimeEnd: null,
    preserveClientIp: false,
    ...overrides,
  } as Provider;
}

const catalogProviders = [
  makeProvider("claude", "claude-opus-5.5"),
  makeProvider("claude-auth", "claude-sonnet-4.5"),
  makeProvider("codex", "gpt-5.1-codex"),
  makeProvider("openai-compatible", "gpt-4o"),
  makeProvider("gemini", "gemini-2.5-pro"),
  makeProvider("gemini-cli", "gemini-cli-model"),
];

function authenticatedRequest(path: string, headers?: Record<string, string>) {
  return createApp().request(`http://localhost${path}`, {
    headers: {
      authorization: "Bearer sk-test",
      ...headers,
    },
  });
}

async function readOpenAIModelIds(path: string, headers?: Record<string, string>) {
  const response = await authenticatedRequest(path, headers);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    object: string;
    data: Array<{ id: string; object: string; owned_by: string }>;
  };
  expect(body.object).toBe("list");
  return body.data.map((model) => model.id);
}

describe("default /v1/models catalog", () => {
  beforeEach(() => {
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValue({
      ok: true,
      user: { id: 1, providerGroup: null, isEnabled: true, expiresAt: null },
      key: { providerGroup: null, name: "test-key" },
    } as never);
    vi.mocked(findAllProviders).mockResolvedValue(catalogProviders);
    vi.mocked(isProviderActiveNow).mockReturnValue(true);
  });

  it("includes every accessible provider type when no format is specified", async () => {
    const ids = await readOpenAIModelIds("/v1/models");

    expect(ids).toEqual([
      "claude-opus-5.5",
      "claude-sonnet-4.5",
      "gemini-2.5-pro",
      "gemini-cli-model",
      "gpt-4o",
      "gpt-5.1-codex",
    ]);
  });

  it("returns a Claude whitelist model for a key that only has a Claude provider", async () => {
    vi.mocked(findAllProviders).mockResolvedValue([makeProvider("claude", "claude-opus-5.5")]);

    const response = await authenticatedRequest("/v1/models");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      object: string;
      data: Array<{ id: string; object: string; owned_by: string }>;
    };

    expect(body).toMatchObject({
      object: "list",
      data: [{ id: "claude-opus-5.5", object: "model", owned_by: "anthropic" }],
    });
  });

  it.each([
    ["/v1/models?format=claude", ["claude-opus-5.5", "claude-sonnet-4.5"]],
    ["/v1/models?format=anthropic", ["claude-opus-5.5", "claude-sonnet-4.5"]],
    ["/v1/models?format=openai", ["gpt-4o", "gpt-5.1-codex"]],
    ["/v1/models?api_type=chat", ["gpt-4o", "gpt-5.1-codex"]],
    ["/v1/models?format=gemini", ["gemini-2.5-pro", "gemini-cli-model"]],
    ["/v1/models?format=gemini-cli", ["gemini-2.5-pro", "gemini-cli-model"]],
    ["/v1/models?format=response", ["gpt-5.1-codex"]],
    ["/v1/models?format=codex", ["gpt-5.1-codex"]],
  ])("keeps explicit format filter for %s", async (path, expectedIds) => {
    expect(await readOpenAIModelIds(path)).toEqual(expectedIds);
  });

  it("keeps header format overrides scoped", async () => {
    expect(await readOpenAIModelIds("/v1/models", { "x-cch-api-type": "claude" })).toEqual([
      "claude-opus-5.5",
      "claude-sonnet-4.5",
    ]);
    expect(await readOpenAIModelIds("/v1/models", { "x-openai-api-type": "openai" })).toEqual([
      "gpt-4o",
      "gpt-5.1-codex",
    ]);
  });

  it("keeps anthropic-version requests scoped to Claude models", async () => {
    const response = await authenticatedRequest("/v1/models", {
      "anthropic-version": "2023-06-01",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      has_more: boolean;
      data: Array<{ id: string; type: string }>;
    };
    expect(body.has_more).toBe(false);
    expect(body.data.map((model) => model.id)).toEqual(["claude-opus-5.5", "claude-sonnet-4.5"]);
    expect(body.data.every((model) => model.type === "model")).toBe(true);
  });

  it("keeps x-goog-api-key requests scoped to Gemini models", async () => {
    const response = await authenticatedRequest("/v1/models", {
      "x-goog-api-key": "gemini-user-key",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { models: Array<{ name: string }> };
    expect(body.models.map((model) => model.name)).toEqual([
      "models/gemini-2.5-pro",
      "models/gemini-cli-model",
    ]);
  });

  it("keeps /v1beta/models scoped to Gemini models", async () => {
    const response = await authenticatedRequest("/v1beta/models");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { models: Array<{ name: string }> };
    expect(body.models.map((model) => model.name)).toEqual([
      "models/gemini-2.5-pro",
      "models/gemini-cli-model",
    ]);
  });

  it("omits disabled, inactive, and out-of-group providers from the default catalog", async () => {
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValue({
      ok: true,
      user: { id: 1, providerGroup: null, isEnabled: true, expiresAt: null },
      key: { providerGroup: "team-a", name: "test-key" },
    } as never);
    vi.mocked(isProviderActiveNow).mockImplementation((start) => start !== "closed");
    vi.mocked(findAllProviders).mockResolvedValue([
      makeProvider("claude", "claude-opus-5.5", { groupTag: "team-a" }),
      makeProvider("claude", "claude-hidden", { isEnabled: false, groupTag: "team-a" }),
      makeProvider("openai-compatible", "gpt-4o", {
        groupTag: "team-a",
        activeTimeStart: "closed",
      }),
      makeProvider("codex", "gpt-5.1-codex", { groupTag: "team-b" }),
    ]);

    expect(await readOpenAIModelIds("/v1/models")).toEqual(["claude-opus-5.5"]);
  });

  it("still returns the Codex CLI manifest fallback before catalog lookup", async () => {
    const response = await authenticatedRequest("/v1/models?client_version=0.144.1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [] });
    expect(findAllProviders).not.toHaveBeenCalled();
  });
});
