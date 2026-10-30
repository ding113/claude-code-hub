import { createHash } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/repository/key", () => ({ resolveApiKeyAuthOutcome: vi.fn() }));
vi.mock("@/repository/provider", () => ({ findAllProviders: vi.fn(async () => []) }));
vi.mock("@/lib/utils/timezone", () => ({ resolveSystemTimezone: vi.fn(async () => "UTC") }));
vi.mock("@/app/v1/_lib/models/codex-model-catalog-service", () => {
  class CodexModelCatalogUnavailableError extends Error {}
  class CodexModelCatalogTooLargeError extends Error {}
  class CodexModelCatalogClientDeniedError extends Error {}
  return {
    getCodexModelCatalog: vi.fn(),
    CodexModelCatalogUnavailableError,
    CodexModelCatalogTooLargeError,
    CodexModelCatalogClientDeniedError,
  };
});
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/utils/error-messages", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/error-messages")>(
    "@/lib/utils/error-messages"
  );
  return { ...actual, getErrorMessageServer: vi.fn(async (_locale: string, code: string) => code) };
});

import { handleAvailableModels } from "@/app/v1/_lib/models/available-models";
import {
  CodexModelCatalogClientDeniedError,
  CodexModelCatalogTooLargeError,
  CodexModelCatalogUnavailableError,
  getCodexModelCatalog,
} from "@/app/v1/_lib/models/codex-model-catalog-service";
import { resolveApiKeyAuthOutcome } from "@/repository/key";
import { findAllProviders } from "@/repository/provider";

const catalog = { models: [{ slug: "gpt-6.1-terra", visibility: "list" }] };
const path = "/v1/models?client_version=0.164.0";
function request(url = path, headers: Record<string, string> = {}) {
  const app = new Hono();
  app.get("/v1/models", handleAvailableModels);
  app.get("/v1beta/models", handleAvailableModels);
  return app.request(`http://localhost${url}`, {
    headers: { authorization: "Bearer test-key", ...headers },
  });
}

describe("Codex native catalog handler", () => {
  beforeEach(() => {
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValue({
      ok: true,
      user: { id: 1, providerGroup: null, isEnabled: true, expiresAt: null, allowedModels: [] },
      key: { providerGroup: null, name: "test" },
    } as never);
    vi.mocked(getCodexModelCatalog).mockResolvedValue(catalog as never);
    vi.mocked(findAllProviders).mockResolvedValue([]);
  });

  it("returns the complete native directory and requests fresh authentication", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(catalog);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-length")).toBe(
      String(Buffer.byteLength(JSON.stringify(catalog)))
    );
    expect(response.headers.get("x-accel-buffering")).toBe("yes");
    expect(resolveApiKeyAuthOutcome).toHaveBeenCalledWith("test-key", { fresh: true });
    expect(getCodexModelCatalog).toHaveBeenCalledWith(
      expect.any(Object),
      "0.164.0",
      expect.any(Headers)
    );
  });

  it("rechecks permissions before honoring a matching ETag", async () => {
    const etag = `W/"${createHash("sha256").update(JSON.stringify(catalog)).digest("hex")}"`;
    const response = await request(path, { "if-none-match": etag });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-length")).toBeNull();
    expect(getCodexModelCatalog).toHaveBeenCalledOnce();
    expect(resolveApiKeyAuthOutcome).toHaveBeenCalledWith("test-key", { fresh: true });
  });

  it("updates the ETag after the permission-filtered result changes", async () => {
    const first = await request();
    const previous = first.headers.get("etag");
    vi.mocked(getCodexModelCatalog).mockResolvedValueOnce({ models: [] });
    const response = await request(path, { "if-none-match": previous ?? "" });
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).not.toBe(previous);
    expect(await response.json()).toEqual({ models: [] });
  });

  it("declares the complete UTF-8 body length for multibyte metadata", async () => {
    vi.mocked(getCodexModelCatalog).mockResolvedValueOnce({
      models: [{ ...catalog.models[0], display_name: "模型" }],
    } as never);
    const response = await request();
    const body = await response.text();
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(body, "utf8")));
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(body.length);
  });

  it.each([
    [new CodexModelCatalogUnavailableError(), 503, "PROXY_MODEL_CATALOG_UNAVAILABLE"],
    [new CodexModelCatalogTooLargeError(), 502, "PROXY_MODEL_CATALOG_TOO_LARGE"],
    [new CodexModelCatalogClientDeniedError(), 403, "PROXY_MODEL_CATALOG_CLIENT_DENIED"],
  ])("localizes catalog failures without caching them", async (error, status, code) => {
    vi.mocked(getCodexModelCatalog).mockRejectedValueOnce(error);
    const response = await request();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { message: code, type: code } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe(status === 503 ? "1" : null);
  });

  it("rejects authentication before evaluating a cached catalog", async () => {
    vi.mocked(resolveApiKeyAuthOutcome).mockResolvedValueOnce({
      ok: false,
      reason: "key_disabled",
    });
    const response = await request(path, { "if-none-match": "*" });
    expect(response.status).toBe(401);
    expect(getCodexModelCatalog).not.toHaveBeenCalled();
  });

  it.each([
    "/v1/models",
    "/v1/models?client_version=%20%20",
    "/v1/models?client_version=0.164.0&format=responses",
  ])("preserves the ordinary model list for %s", async (url) => {
    const response = await request(url);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ object: "list", data: [] });
    expect(getCodexModelCatalog).not.toHaveBeenCalled();
    expect(resolveApiKeyAuthOutcome).toHaveBeenCalledWith("test-key");
  });

  it("preserves the Gemini metadata route", async () => {
    const response = await request("/v1beta/models?client_version=0.164.0");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [] });
    expect(getCodexModelCatalog).not.toHaveBeenCalled();
  });
});
