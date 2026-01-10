import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchCloudPriceTableToml,
  parseCloudPriceTableToml,
} from "@/lib/price-sync/cloud-price-table";

describe("parseCloudPriceTableToml", () => {
  it('parses [models."..."] tables into a model map', () => {
    const toml = [
      "[metadata]",
      'version = "test"',
      "",
      '[models."m1"]',
      'display_name = "Model One"',
      'mode = "chat"',
      'litellm_provider = "anthropic"',
      "input_cost_per_token = 0.000001",
      "supports_vision = true",
      "",
      '[models."m1".pricing."anthropic"]',
      "input_cost_per_token = 0.000001",
      "",
      '[models."m2"]',
      'mode = "image_generation"',
      'litellm_provider = "openai"',
      "output_cost_per_image = 0.02",
      "",
    ].join("\n");

    const result = parseCloudPriceTableToml(toml);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.data.models).sort()).toEqual(["m1", "m2"]);
    expect(result.data.metadata?.version).toBe("test");

    expect(result.data.models.m1.display_name).toBe("Model One");
    expect(result.data.models.m1.mode).toBe("chat");
    expect(result.data.models.m1.litellm_provider).toBe("anthropic");
    expect(result.data.models.m1.supports_vision).toBe(true);

    const pricing = result.data.models.m1.pricing as {
      anthropic?: { input_cost_per_token?: number };
    };
    expect(pricing.anthropic?.input_cost_per_token).toBe(0.000001);
  });

  it("returns an error when models table is missing", () => {
    const toml = ["[metadata]", 'version = "test"'].join("\n");
    const result = parseCloudPriceTableToml(toml);
    expect(result.ok).toBe(false);
  });

  it("returns an error when TOML is invalid", () => {
    const toml = "[models\ninvalid = true";
    const result = parseCloudPriceTableToml(toml);
    expect(result.ok).toBe(false);
  });

  it("returns an error when models table is empty", () => {
    const toml = ["[models]"].join("\n");
    const result = parseCloudPriceTableToml(toml);
    expect(result.ok).toBe(false);
  });

  it("ignores reserved keys in models table", () => {
    const toml = [
      '[models."__proto__"]',
      'mode = "chat"',
      "input_cost_per_token = 0.000001",
      "",
      '[models."safe-model"]',
      'mode = "chat"',
      "input_cost_per_token = 0.000001",
      "",
    ].join("\n");

    const result = parseCloudPriceTableToml(toml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.data.models)).toEqual(["safe-model"]);
  });

  it("returns an error when root is not an object (defensive)", async () => {
    vi.resetModules();
    vi.doMock("@iarna/toml", () => ({
      default: {
        parse: () => 123,
      },
    }));

    const mod = await import("@/lib/price-sync/cloud-price-table");
    const result = mod.parseCloudPriceTableToml("[models]");
    expect(result.ok).toBe(false);

    vi.doUnmock("@iarna/toml");
  });
});

describe("fetchCloudPriceTableToml", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns ok=true when response is ok and body is non-empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "toml content",
      }))
    );

    const result = await fetchCloudPriceTableToml("https://example.test/prices.toml");
    expect(result.ok).toBe(true);
  });

  it("returns ok=false when response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        text: async () => "not found",
      }))
    );

    const result = await fetchCloudPriceTableToml("https://example.test/prices.toml");
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when response url redirects to unexpected host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "https://evil.test/prices.toml",
        text: async () => "toml content",
      }))
    );

    const result = await fetchCloudPriceTableToml("https://example.test/prices.toml");
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when response url redirects to unexpected pathname", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "https://example.test/evil.toml",
        text: async () => "toml content",
      }))
    );

    const result = await fetchCloudPriceTableToml("https://example.test/prices.toml");
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when url is invalid and fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Invalid URL");
      })
    );

    const result = await fetchCloudPriceTableToml("not-a-url");
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when response body is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "   ",
      }))
    );

    const result = await fetchCloudPriceTableToml("https://example.test/prices.toml");
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when request times out and aborts", async () => {
    vi.useFakeTimers();

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, init?: { signal?: AbortSignal }) =>
          await new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new Error("AbortError"));
            });
          })
      )
    );

    const promise = fetchCloudPriceTableToml("https://example.test/prices.toml");
    await vi.advanceTimersByTimeAsync(10000);

    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when fetch throws a non-Error value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "boom";
      })
    );

    const result = await fetchCloudPriceTableToml("https://example.test/prices.toml");
    expect(result.ok).toBe(false);
  });
});
