import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  checkProviderGroupMatch: vi.fn().mockReturnValue(true),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("@/lib/utils/error-messages", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/error-messages")>(
    "@/lib/utils/error-messages"
  );
  return {
    ...actual,
    getErrorMessageServer: vi.fn(async (_locale: string, code: string) => code),
  };
});

import { handleAvailableModels } from "@/app/v1/_lib/models/available-models";
import { resolveApiKeyAuthOutcome } from "@/repository/key";
import { findAllProviders } from "@/repository/provider";

const CODEX_MODELS_ETAG = 'W/"cch-codex-bundled-v1"';

function createApp() {
  const app = new Hono();
  app.get("/v1/models", handleAvailableModels);
  app.get("/v1beta/models", handleAvailableModels);
  return app;
}

function authenticatedRequest(path: string, headers?: Record<string, string>) {
  return createApp().request(`http://localhost${path}`, {
    headers: {
      authorization: "Bearer sk-test",
      ...headers,
    },
  });
}

describe("Codex models manifest fallback", () => {
  beforeEach(() => {
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValue({
      ok: true,
      user: { id: 1, providerGroup: null, isEnabled: true, expiresAt: null },
      key: { providerGroup: null, name: "test-key" },
    } as never);
    vi.mocked(findAllProviders).mockResolvedValue([]);
  });

  it("returns an empty Codex manifest for a non-empty client_version", async () => {
    const response = await authenticatedRequest("/v1/models?client_version=0.144.1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [] });
    expect(response.headers.get("etag")).toBe(CODEX_MODELS_ETAG);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(findAllProviders).not.toHaveBeenCalled();
  });

  it.each([
    CODEX_MODELS_ETAG,
    `"other", ${CODEX_MODELS_ETAG}`,
    "*",
  ])("returns 304 when If-None-Match is %s", async (ifNoneMatch) => {
    const response = await authenticatedRequest("/v1/models?client_version=0.144.1", {
      "if-none-match": ifNoneMatch,
    });

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(CODEX_MODELS_ETAG);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe("");
    expect(findAllProviders).not.toHaveBeenCalled();
  });

  it("keeps the OpenAI models response for requests without client_version", async () => {
    const response = await authenticatedRequest("/v1/models");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ object: "list", data: [] });
    expect(response.headers.get("etag")).toBeNull();
    expect(findAllProviders).toHaveBeenCalledTimes(1);
  });

  it("ignores a whitespace-only client_version", async () => {
    const response = await authenticatedRequest("/v1/models?client_version=%20%20");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ object: "list", data: [] });
    expect(findAllProviders).toHaveBeenCalledTimes(1);
  });

  it("keeps Gemini model discovery for /v1beta/models with client_version", async () => {
    const response = await authenticatedRequest("/v1beta/models?client_version=0.144.1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [] });
    expect(response.headers.get("etag")).toBeNull();
    expect(findAllProviders).toHaveBeenCalledTimes(1);
  });

  it("still requires authentication before returning the fallback manifest", async () => {
    const response = await createApp().request("http://localhost/v1/models?client_version=0.144.1");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { message: "未提供认证凭据", type: "authentication_error" },
    });
    expect(resolveApiKeyAuthOutcome).not.toHaveBeenCalled();
    expect(findAllProviders).not.toHaveBeenCalled();
  });

  it("rejects an invalid API key before returning the fallback manifest", async () => {
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValueOnce({
      ok: false,
      reason: "not_found",
    });

    const response = await authenticatedRequest("/v1/models?client_version=0.144.1");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { message: "PROXY_INVALID_API_KEY", type: "invalid_api_key" },
    });
    expect(findAllProviders).not.toHaveBeenCalled();
  });
});
