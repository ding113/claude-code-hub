import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudPriceTableResult } from "@/lib/price-sync/cloud-price-table";

const asyncTasks: Promise<void>[] = [];

let asyncTaskManagerLoaded = false;

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/lib/async-task-manager", () => {
  asyncTaskManagerLoaded = true;
  return {
    AsyncTaskManager: {
      getActiveTasks: vi.fn(() => []),
      register: vi.fn((_taskId: string, promise: Promise<void>) => {
        asyncTasks.push(promise);
        return new AbortController();
      }),
    },
  };
});

vi.mock("@/actions/model-prices", () => ({
  processPriceTableInternal: vi.fn(async () => ({
    ok: true,
    data: {
      added: [],
      updated: [],
      unchanged: [],
      failed: [],
      total: 0,
    },
  })),
}));

vi.mock("@/repository/model-price", () => ({
  deleteCloudPricesNotIn: vi.fn(async () => 0),
  countCloudModelPrices: vi.fn(async () => 0),
}));

vi.mock("@/repository/cloud-pricing-catalog", () => ({
  upsertCloudPricingCatalog: vi.fn(async () => {}),
  getCloudPricingCatalog: vi.fn(async () => null),
}));

/** 构造最小可用的 CPT v1 价格表 JSON 文本 */
function buildCptJson(options?: { version?: string; modelName?: string }): string {
  const modelName = options?.modelName ?? "m1";
  return JSON.stringify({
    schema: "cchp.pricing-table/v1",
    version: options?.version ?? "test-version",
    currency: "USD",
    refreshed_at: "2026-07-01T00:00:00.000Z",
    providers: {
      anthropic: { name: "Anthropic", icon: "anthropic.svg", icon_mono: true },
    },
    models: [
      {
        slug: `anthropic/${modelName}`,
        model_name: modelName,
        vendor: "anthropic",
        display_name: "Model One",
        model_type: "chat",
        endpoints: { inbound: ["anthropic-messages"], outbound: ["anthropic-messages"] },
        pricing: [
          {
            provider: "anthropic",
            official: true,
            source: "test",
            charges: {
              prompt: { unit: "per_M_tokens", price: "3" },
              completion: { unit: "per_M_tokens", price: "15" },
            },
            tracks: [{ label: "standard", factor: "1", triggers: [] }],
          },
        ],
      },
    ],
  });
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
}

describe("syncCloudPriceTableToDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    asyncTasks.splice(0, asyncTasks.length);
    vi.unstubAllGlobals();
    asyncTaskManagerLoaded = false;
  });

  it("returns ok=false when cloud fetch fails with HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "server error",
      }))
    );

    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase();
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when cloud fetch returns empty body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "   ",
      }))
    );

    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase();
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when payload has wrong schema id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ schema: "other/v9", models: [], providers: {} }),
      }))
    );

    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase();
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when processPriceTableInternal returns ok=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => buildCptJson(),
      }))
    );

    const { processPriceTableInternal } = await import("@/actions/model-prices");
    vi.mocked(processPriceTableInternal).mockResolvedValue({
      ok: false,
      error: "write failed",
    } as unknown as CloudPriceTableResult<unknown>);

    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase();
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when processPriceTableInternal returns ok=true but data is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => buildCptJson(),
      }))
    );

    const { processPriceTableInternal } = await import("@/actions/model-prices");
    vi.mocked(processPriceTableInternal).mockResolvedValue({
      ok: true,
      data: undefined,
    } as unknown as CloudPriceTableResult<unknown>);

    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase();
    expect(result.ok).toBe(false);
  });

  it("returns ok=true and passes source='cloud' when table parses and write succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => buildCptJson(),
      }))
    );

    const { processPriceTableInternal } = await import("@/actions/model-prices");
    vi.mocked(processPriceTableInternal).mockResolvedValue({
      ok: true,
      data: {
        added: ["m1"],
        updated: [],
        unchanged: [],
        failed: [],
        total: 1,
      },
    } as any);

    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase();
    expect(result.ok).toBe(true);
    expect(processPriceTableInternal).toHaveBeenCalledTimes(1);
    const [jsonContent, overwrite, source] = vi.mocked(processPriceTableInternal).mock.calls[0];
    expect(source).toBe("cloud");
    expect(overwrite).toBeUndefined();
    const models = JSON.parse(jsonContent as string);
    expect(models.m1.vendor).toBe("anthropic");
    expect(models.m1.input_cost_per_token).toBeCloseTo(0.000003, 12);

    // 整表切换:清理云端不存在的旧行 + 目录元数据落库
    const { deleteCloudPricesNotIn } = await import("@/repository/model-price");
    expect(vi.mocked(deleteCloudPricesNotIn)).toHaveBeenCalledWith(["m1"]);
    const { upsertCloudPricingCatalog } = await import("@/repository/cloud-pricing-catalog");
    expect(vi.mocked(upsertCloudPricingCatalog)).toHaveBeenCalledWith(
      expect.objectContaining({ version: "test-version", modelCount: 1 })
    );
  });

  it("skips write when version fingerprint and row count are unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => buildCptJson({ version: "same-version" }),
      }))
    );

    const { getCloudPricingCatalog } = await import("@/repository/cloud-pricing-catalog");
    vi.mocked(getCloudPricingCatalog).mockResolvedValue({
      version: "same-version",
      currency: "USD",
      refreshedAt: null,
      providers: {},
      vendors: [],
      modelCount: 1,
      syncedAt: null,
    });
    const { countCloudModelPrices } = await import("@/repository/model-price");
    vi.mocked(countCloudModelPrices).mockResolvedValue(1);

    const { processPriceTableInternal } = await import("@/actions/model-prices");
    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.unchanged).toEqual(["m1"]);
      expect(result.data.added).toEqual([]);
    }
    expect(processPriceTableInternal).not.toHaveBeenCalled();
  });

  it("does not skip when overwriteManual is provided even if version matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => buildCptJson({ version: "same-version" }),
      }))
    );

    const { getCloudPricingCatalog } = await import("@/repository/cloud-pricing-catalog");
    vi.mocked(getCloudPricingCatalog).mockResolvedValue({
      version: "same-version",
      currency: "USD",
      refreshedAt: null,
      providers: {},
      vendors: [],
      modelCount: 1,
      syncedAt: null,
    });

    const { processPriceTableInternal } = await import("@/actions/model-prices");
    vi.mocked(processPriceTableInternal).mockResolvedValue({
      ok: true,
      data: { added: [], updated: ["m1"], unchanged: [], failed: [], total: 1 },
    } as any);

    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase(["m1"]);

    expect(result.ok).toBe(true);
    expect(processPriceTableInternal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processPriceTableInternal).mock.calls[0][1]).toEqual(["m1"]);
  });

  it("falls back to default error message when write returns ok=false without error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => buildCptJson(),
      }))
    );

    const { processPriceTableInternal } = await import("@/actions/model-prices");
    vi.mocked(processPriceTableInternal).mockResolvedValue({
      ok: false,
      error: undefined,
    } as unknown as CloudPriceTableResult<unknown>);

    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase();

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, error: "云端价格表写入失败" });
  });

  it("returns ok=false when write throws Error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => buildCptJson(),
      }))
    );

    const { processPriceTableInternal } = await import("@/actions/model-prices");
    vi.mocked(processPriceTableInternal).mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase();

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("boom") });
  });

  it("returns ok=false when write throws non-Error value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => buildCptJson(),
      }))
    );

    const { processPriceTableInternal } = await import("@/actions/model-prices");
    vi.mocked(processPriceTableInternal).mockImplementationOnce(async () => {
      throw "boom";
    });

    const { syncCloudPriceTableToDatabase } = await import("@/lib/price-sync/cloud-price-updater");
    const result = await syncCloudPriceTableToDatabase();

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("boom") });
  });
});

describe("requestCloudPriceTableSync", () => {
  const prevRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    asyncTasks.splice(0, asyncTasks.length);
    vi.unstubAllGlobals();
    asyncTaskManagerLoaded = false;
    delete (globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_LAST_AT__?: number })
      .__CCH_CLOUD_PRICE_SYNC_LAST_AT__;
    delete (globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_SCHEDULING__?: boolean })
      .__CCH_CLOUD_PRICE_SYNC_SCHEDULING__;

    process.env.NEXT_RUNTIME = "nodejs";
  });

  afterEach(() => {
    if (prevRuntime === undefined) {
      delete process.env.NEXT_RUNTIME;
      return;
    }
    process.env.NEXT_RUNTIME = prevRuntime;
  });

  it("no-ops in Edge runtime (does not load AsyncTaskManager)", async () => {
    const prevRuntime = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = "edge";

    const { requestCloudPriceTableSync } = await import("@/lib/price-sync/cloud-price-updater");
    requestCloudPriceTableSync({ reason: "missing-model", throttleMs: 0 });
    await flushAsync();

    expect(asyncTaskManagerLoaded).toBe(false);

    process.env.NEXT_RUNTIME = prevRuntime;
  });

  it("does nothing when same task is already active", async () => {
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    const { requestCloudPriceTableSync } = await import("@/lib/price-sync/cloud-price-updater");

    vi.mocked(AsyncTaskManager.getActiveTasks).mockReturnValue([
      { taskId: "cloud-price-table-sync" },
    ] as any);

    requestCloudPriceTableSync({ reason: "missing-model", throttleMs: 0 });
    await flushAsync();

    expect(AsyncTaskManager.register).not.toHaveBeenCalled();
  });

  it("throttles when called within throttle window", async () => {
    (
      globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_LAST_AT__?: number }
    ).__CCH_CLOUD_PRICE_SYNC_LAST_AT__ = Date.now();

    const { requestCloudPriceTableSync } = await import("@/lib/price-sync/cloud-price-updater");
    requestCloudPriceTableSync({ reason: "missing-model", throttleMs: 60_000 });
    await flushAsync();

    expect(asyncTaskManagerLoaded).toBe(false);
  });

  it("uses default throttleMs when not provided", async () => {
    (
      globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_LAST_AT__?: number }
    ).__CCH_CLOUD_PRICE_SYNC_LAST_AT__ = Date.now();

    const { requestCloudPriceTableSync } = await import("@/lib/price-sync/cloud-price-updater");
    requestCloudPriceTableSync({ reason: "missing-model" });
    await flushAsync();

    expect(asyncTaskManagerLoaded).toBe(false);
  });

  it("does nothing when scheduling flag is already set", async () => {
    (
      globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_SCHEDULING__?: boolean }
    ).__CCH_CLOUD_PRICE_SYNC_SCHEDULING__ = true;

    const { requestCloudPriceTableSync } = await import("@/lib/price-sync/cloud-price-updater");
    requestCloudPriceTableSync({ reason: "missing-model", throttleMs: 0 });
    await flushAsync();

    expect(asyncTaskManagerLoaded).toBe(false);
  });

  it("logs warn when scheduling fails with Error", async () => {
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    vi.mocked(AsyncTaskManager.getActiveTasks).mockImplementationOnce(() => {
      throw new Error("import fail");
    });

    const { requestCloudPriceTableSync } = await import("@/lib/price-sync/cloud-price-updater");
    requestCloudPriceTableSync({ reason: "scheduled", throttleMs: 0 });
    await flushAsync();

    const { logger } = await import("@/lib/logger");
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "[PriceSync] Cloud price sync scheduling failed",
      expect.objectContaining({ error: "import fail" })
    );
  });

  it("logs warn when scheduling fails with non-Error value", async () => {
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    vi.mocked(AsyncTaskManager.getActiveTasks).mockImplementationOnce(() => {
      throw "import fail";
    });

    const { requestCloudPriceTableSync } = await import("@/lib/price-sync/cloud-price-updater");
    requestCloudPriceTableSync({ reason: "scheduled", throttleMs: 0 });
    await flushAsync();

    const { logger } = await import("@/lib/logger");
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "[PriceSync] Cloud price sync scheduling failed",
      expect.objectContaining({ error: "import fail" })
    );
  });

  it("registers a task and updates throttle timestamp after completion", async () => {
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    const { processPriceTableInternal } = await import("@/actions/model-prices");

    let resolveFetch: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => await fetchPromise)
    );

    vi.mocked(processPriceTableInternal).mockResolvedValue({
      ok: true,
      data: {
        added: ["m1"],
        updated: [],
        unchanged: [],
        failed: [],
        total: 1,
      },
    } as any);

    const { requestCloudPriceTableSync } = await import("@/lib/price-sync/cloud-price-updater");
    requestCloudPriceTableSync({ reason: "missing-model", throttleMs: 0 });
    await flushAsync();

    expect(AsyncTaskManager.register).toHaveBeenCalledTimes(1);

    const g = globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_LAST_AT__?: number };
    expect(g.__CCH_CLOUD_PRICE_SYNC_LAST_AT__).toBeUndefined();

    resolveFetch!({
      ok: true,
      status: 200,
      text: async () => buildCptJson(),
    });

    await Promise.all(asyncTasks.splice(0, asyncTasks.length));

    expect(processPriceTableInternal).toHaveBeenCalledTimes(1);
    const { logger } = await import("@/lib/logger");
    expect(vi.mocked(logger.info)).toHaveBeenCalled();
    expect(typeof g.__CCH_CLOUD_PRICE_SYNC_LAST_AT__).toBe("number");
  });

  it("logs warn when sync task fails", async () => {
    const { AsyncTaskManager } = await import("@/lib/async-task-manager");
    const { requestCloudPriceTableSync } = await import("@/lib/price-sync/cloud-price-updater");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "server error",
      }))
    );

    requestCloudPriceTableSync({ reason: "scheduled", throttleMs: 0 });

    await flushAsync();
    expect(AsyncTaskManager.register).toHaveBeenCalledTimes(1);
    await Promise.all(asyncTasks.splice(0, asyncTasks.length));

    const { logger } = await import("@/lib/logger");
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });
});
