import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => {
  const values = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values }));
  return {
    tx: {
      execute: vi.fn(async () => undefined),
      insert,
    },
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => callback(dbMock.tx)),
    values,
  };
});

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: dbMock.transaction,
  },
}));

describe("upsertCloudPricingCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("stores null-prototype provider maps as plain JSON objects", async () => {
    const providers = Object.create(null);
    providers.openai = { name: "OpenAI" };
    const { upsertCloudPricingCatalog } = await import("@/repository/cloud-pricing-catalog");

    await upsertCloudPricingCatalog({
      version: "v1",
      currency: "USD",
      refreshedAt: "2026-01-01T00:00:00.000Z",
      providers,
      vendors: [{ vendor: "openai", name: "OpenAI", modelCount: 1 }],
      modelCount: 1,
    });

    const inserted = dbMock.values.mock.calls[0]?.[0];
    expect(Object.getPrototypeOf(inserted.providers)).toBe(Object.prototype);
    expect(inserted.providers).toEqual({ openai: { name: "OpenAI" } });
  });
});
