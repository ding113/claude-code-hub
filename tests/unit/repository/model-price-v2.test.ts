import { beforeEach, describe, expect, test, vi } from "vitest";

let insertedPriceValues: unknown;
let selectedPrices: unknown[] = [];
let executedRows: unknown[] = [];

vi.mock("@/drizzle/db", () => {
  const insertReturningMock = vi.fn(async () => selectedPrices);
  const insertValuesMock = vi.fn((values: unknown) => {
    insertedPriceValues = values;
    return { returning: insertReturningMock };
  });
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const selectLimitMock = vi.fn(async () => selectedPrices);
  const selectOrderByMock = vi.fn(() => ({ limit: selectLimitMock }));
  const selectWhereMock = vi.fn(() => ({ orderBy: selectOrderByMock }));
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const executeMock = vi.fn(async () => executedRows);

  return {
    db: {
      insert: insertMock,
      select: selectMock,
      execute: executeMock,
    },
  };
});

describe("model-price-v2 repository", () => {
  beforeEach(() => {
    insertedPriceValues = undefined;
    selectedPrices = [];
    executedRows = [];
  });

  test("createModelPriceV2 stores source and remoteVersion", async () => {
    selectedPrices = [
      {
        id: 1,
        modelName: "gpt-4o",
        priceData: { input_cost_per_token: 1 },
        source: "remote",
        isUserOverride: false,
        remoteVersion: "2025.12.25",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    ];

    const { createModelPriceV2 } = await import("@/repository/model-price-v2");

    const price = await createModelPriceV2({
      modelName: "gpt-4o",
      priceData: { input_cost_per_token: 1 },
      source: "remote",
      remoteVersion: "2025.12.25",
    });

    expect(insertedPriceValues).toMatchObject({
      modelName: "gpt-4o",
      source: "remote",
      remoteVersion: "2025.12.25",
    });
    expect(price.modelName).toBe("gpt-4o");
  });

  test("findLatestPriceV2ByModel returns null when no row", async () => {
    selectedPrices = [];

    const { findLatestPriceV2ByModel } = await import("@/repository/model-price-v2");
    const result = await findLatestPriceV2ByModel("missing");

    expect(result).toBeNull();
  });

  test("findAllLatestPricesV2 maps db.execute rows", async () => {
    executedRows = [
      {
        id: 2,
        modelName: "claude-3-5-sonnet",
        priceData: { output_cost_per_token: 2 },
        source: "local",
        isUserOverride: false,
        remoteVersion: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    ];

    const { findAllLatestPricesV2 } = await import("@/repository/model-price-v2");
    const result = await findAllLatestPricesV2();

    expect(result).toHaveLength(1);
    expect(result[0].modelName).toBe("claude-3-5-sonnet");
  });
});
