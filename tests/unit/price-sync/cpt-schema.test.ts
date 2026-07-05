import { describe, expect, it } from "vitest";
import {
  CPT_SCHEMA_ID,
  isCptTableLike,
  parseCptTable,
  parseCptTableValue,
} from "@/lib/price-sync/cpt-schema";

function validTable(overrides?: Record<string, unknown>) {
  return {
    schema: CPT_SCHEMA_ID,
    version: "abc123",
    currency: "USD",
    refreshed_at: "2026-07-01T00:00:00.000Z",
    providers: {
      anthropic: { name: "Anthropic", icon: "anthropic.svg", icon_mono: true },
    },
    models: [
      {
        slug: "anthropic/claude-sonnet-4-5",
        model_name: "claude-sonnet-4-5",
        vendor: "anthropic",
        display_name: "Claude Sonnet 4.5",
        pricing: [
          {
            provider: "anthropic",
            official: true,
            source: "test",
            charges: { prompt: { unit: "per_M_tokens", price: "3" } },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("parseCptTable", () => {
  it("parses a valid CPT v1 table", () => {
    const result = parseCptTable(JSON.stringify(validTable()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.version).toBe("abc123");
    expect(result.data.currency).toBe("USD");
    expect(result.data.models).toHaveLength(1);
    expect(result.data.providers.anthropic?.name).toBe("Anthropic");
  });

  it("rejects invalid JSON", () => {
    const result = parseCptTable("{not json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("JSON");
  });

  it("rejects non-object roots", () => {
    expect(parseCptTable("42").ok).toBe(false);
    expect(parseCptTable("[]").ok).toBe(false);
  });

  it("rejects wrong schema id", () => {
    const result = parseCptTable(JSON.stringify(validTable({ schema: "other/v2" })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("schema");
  });

  it("rejects missing models array", () => {
    const result = parseCptTable(JSON.stringify(validTable({ models: undefined })));
    expect(result.ok).toBe(false);
  });

  it("rejects missing providers dictionary", () => {
    const result = parseCptTable(JSON.stringify(validTable({ providers: undefined })));
    expect(result.ok).toBe(false);
  });

  it("skips malformed model entries but keeps valid ones", () => {
    const table = validTable();
    table.models = [
      ...table.models,
      { slug: "", model_name: "x", vendor: "v", display_name: "X", pricing: [] },
      { model_name: "no-slug", vendor: "v", display_name: "N", pricing: [] },
      "not-an-object",
    ] as never;
    const result = parseCptTableValue(table);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.models).toHaveLength(1);
  });

  it("rejects when all models are malformed", () => {
    const result = parseCptTableValue(validTable({ models: [{ bogus: true }] }));
    expect(result.ok).toBe(false);
  });

  it("drops dangerous provider keys", () => {
    const table = validTable();
    // JSON.parse 才会产生自有 "__proto__" 属性;对象字面量赋值只改原型链,测不到过滤逻辑
    (table as Record<string, unknown>).providers = JSON.parse(
      '{"anthropic":{"name":"Anthropic"},"__proto__":{"name":"evil"},"constructor":{"name":"evil"},"prototype":{"name":"evil"}}'
    );
    const result = parseCptTableValue(table);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data.providers)).toEqual(["anthropic"]);
  });
});

describe("isCptTableLike", () => {
  it("detects CPT payloads for upload sniffing", () => {
    expect(isCptTableLike(validTable())).toBe(true);
    expect(isCptTableLike({ "gpt-4": { mode: "chat" } })).toBe(false);
    expect(isCptTableLike(null)).toBe(false);
    expect(isCptTableLike([])).toBe(false);
  });
});
