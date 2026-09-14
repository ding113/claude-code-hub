import { beforeEach, describe, expect, test, vi } from "vitest";

const invalidationMocks = vi.hoisted(() => ({
  scheduleModelPriceCacheInvalidation: vi.fn(),
}));
vi.mock("@/lib/cache/model-price-invalidation", () => invalidationMocks);

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const dbMocks = vi.hoisted(() => {
  const row = {
    id: 1,
    modelName: "m",
    priceData: {},
    source: "manual",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const returning = vi.fn(async () => [row]);
  const insertChain = { values: vi.fn(() => ({ returning })) };
  const deleteWhere = vi.fn(async () => undefined);
  const tx = {
    delete: vi.fn(() => ({ where: deleteWhere })),
    insert: vi.fn(() => insertChain),
  };
  const selectChain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy"]) {
    selectChain[method] = vi.fn(() => selectChain);
  }
  selectChain.limit = vi.fn(async () => {
    throw new Error("select failed");
  });
  return {
    db: {
      insert: vi.fn(() => insertChain),
      delete: vi.fn(() => ({ where: deleteWhere })),
      transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      execute: vi.fn(async () => ({ count: 3 })),
      select: vi.fn(() => selectChain),
    },
  };
});
vi.mock("@/drizzle/db", () => dbMocks);

import {
  createModelPrice,
  deleteCloudPricesNotIn,
  deleteModelPriceByName,
  findLatestPriceByModel,
  queryLatestPriceByModel,
  upsertModelPrice,
} from "@/repository/model-price";

describe("model price writes invalidate the lookup cache", () => {
  beforeEach(() => {
    invalidationMocks.scheduleModelPriceCacheInvalidation.mockClear();
  });

  test("createModelPrice", async () => {
    await createModelPrice("m", {});
    expect(invalidationMocks.scheduleModelPriceCacheInvalidation).toHaveBeenCalledTimes(1);
  });

  test("upsertModelPrice invalidates after the transaction commits", async () => {
    await upsertModelPrice("m", {});
    expect(dbMocks.db.transaction).toHaveBeenCalled();
    expect(invalidationMocks.scheduleModelPriceCacheInvalidation).toHaveBeenCalledTimes(1);
  });

  test("deleteModelPriceByName", async () => {
    await deleteModelPriceByName("m");
    expect(invalidationMocks.scheduleModelPriceCacheInvalidation).toHaveBeenCalledTimes(1);
  });

  test("deleteCloudPricesNotIn invalidates only when it executes", async () => {
    await expect(deleteCloudPricesNotIn([])).resolves.toBe(0);
    expect(invalidationMocks.scheduleModelPriceCacheInvalidation).not.toHaveBeenCalled();

    await expect(deleteCloudPricesNotIn(["m"])).resolves.toBe(3);
    expect(invalidationMocks.scheduleModelPriceCacheInvalidation).toHaveBeenCalledTimes(1);
  });
});

describe("model price lookup error contracts", () => {
  test("queryLatestPriceByModel throws database errors", async () => {
    await expect(queryLatestPriceByModel("m")).rejects.toThrow("select failed");
  });

  test("findLatestPriceByModel reports database errors as null", async () => {
    await expect(findLatestPriceByModel("m")).resolves.toBeNull();
  });
});
