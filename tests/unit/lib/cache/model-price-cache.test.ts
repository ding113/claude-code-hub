import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ModelPrice } from "@/types/model-price";

const envState = vi.hoisted(() => ({ ENABLE_MODEL_PRICE_CACHE: true }));
const repositoryMocks = vi.hoisted(() => ({
  queryLatestPriceByModel: vi.fn(),
}));
const pubsubMocks = vi.hoisted(() => ({
  callbacks: new Map<string, (message: string) => void>(),
  publishCacheInvalidation: vi.fn(async () => undefined),
}));
const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => envState,
  isDevelopment: () => false,
}));
vi.mock("@/lib/logger", () => ({ logger: loggerMocks }));
vi.mock("@/repository/model-price", () => repositoryMocks);
vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_MODEL_PRICES_UPDATED: "cch:cache:model_prices:updated",
  publishCacheInvalidation: pubsubMocks.publishCacheInvalidation,
  subscribeCacheInvalidation: vi.fn(async (channel: string, callback: (m: string) => void) => {
    pubsubMocks.callbacks.set(channel, callback);
    return () => undefined;
  }),
}));

import { findLatestPriceByModelCached } from "@/lib/cache/model-price-cache";
import {
  getModelPriceCacheStats,
  invalidateModelPriceCache,
  MODEL_PRICE_INVALIDATION_PUBLISH_DEBOUNCE_MS,
  resetModelPriceCacheForTests,
  scheduleModelPriceCacheInvalidation,
} from "@/lib/cache/model-price-invalidation";

function makePrice(modelName: string, inputCost: number): ModelPrice {
  return {
    id: inputCost,
    modelName,
    priceData: { input_cost_per_token: inputCost },
    source: "litellm",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("model price lookup cache", () => {
  beforeEach(() => {
    envState.ENABLE_MODEL_PRICE_CACHE = true;
    repositoryMocks.queryLatestPriceByModel.mockReset();
    pubsubMocks.callbacks.clear();
    pubsubMocks.publishCacheInvalidation.mockClear();
    loggerMocks.error.mockClear();
    resetModelPriceCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("caches hits and misses by model name", async () => {
    repositoryMocks.queryLatestPriceByModel.mockImplementation(async (name: string) =>
      name === "known" ? makePrice("known", 1) : null
    );

    await expect(findLatestPriceByModelCached("known")).resolves.toMatchObject({ id: 1 });
    await expect(findLatestPriceByModelCached("known")).resolves.toMatchObject({ id: 1 });
    await expect(findLatestPriceByModelCached("unknown")).resolves.toBeNull();
    await expect(findLatestPriceByModelCached("unknown")).resolves.toBeNull();

    expect(repositoryMocks.queryLatestPriceByModel).toHaveBeenCalledTimes(2);
    expect(getModelPriceCacheStats().size).toBe(2);
  });

  test("returns null without caching when the database fails", async () => {
    repositoryMocks.queryLatestPriceByModel
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(makePrice("m", 2));

    await expect(findLatestPriceByModelCached("m")).resolves.toBeNull();
    expect(loggerMocks.error).toHaveBeenCalledTimes(1);
    await expect(findLatestPriceByModelCached("m")).resolves.toMatchObject({ id: 2 });
    expect(repositoryMocks.queryLatestPriceByModel).toHaveBeenCalledTimes(2);
  });

  test("bypasses the cache when ENABLE_MODEL_PRICE_CACHE is false", async () => {
    envState.ENABLE_MODEL_PRICE_CACHE = false;
    repositoryMocks.queryLatestPriceByModel.mockResolvedValue(makePrice("m", 1));

    await findLatestPriceByModelCached("m");
    await findLatestPriceByModelCached("m");

    expect(repositoryMocks.queryLatestPriceByModel).toHaveBeenCalledTimes(2);
  });

  test("a price write clears the cache immediately and publishes one debounced broadcast", async () => {
    vi.useFakeTimers();
    repositoryMocks.queryLatestPriceByModel
      .mockResolvedValueOnce(makePrice("m", 1))
      .mockResolvedValueOnce(makePrice("m", 5));

    await expect(findLatestPriceByModelCached("m")).resolves.toMatchObject({ id: 1 });

    scheduleModelPriceCacheInvalidation();
    scheduleModelPriceCacheInvalidation();
    scheduleModelPriceCacheInvalidation();

    await expect(findLatestPriceByModelCached("m")).resolves.toMatchObject({ id: 5 });
    expect(pubsubMocks.publishCacheInvalidation).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MODEL_PRICE_INVALIDATION_PUBLISH_DEBOUNCE_MS);
    expect(pubsubMocks.publishCacheInvalidation).toHaveBeenCalledTimes(1);
    expect(pubsubMocks.publishCacheInvalidation).toHaveBeenCalledWith(
      "cch:cache:model_prices:updated"
    );
  });

  test("invalidates when another process publishes a price change", async () => {
    repositoryMocks.queryLatestPriceByModel.mockResolvedValue(makePrice("m", 1));

    await findLatestPriceByModelCached("m");
    await flushMicrotasks();
    pubsubMocks.callbacks.get("cch:cache:model_prices:updated")?.("1");
    await findLatestPriceByModelCached("m");

    expect(repositoryMocks.queryLatestPriceByModel).toHaveBeenCalledTimes(2);
  });

  test("invalidateModelPriceCache clears entries locally", async () => {
    repositoryMocks.queryLatestPriceByModel.mockResolvedValue(makePrice("m", 1));

    await findLatestPriceByModelCached("m");
    invalidateModelPriceCache();

    expect(getModelPriceCacheStats().size).toBe(0);
  });
});
