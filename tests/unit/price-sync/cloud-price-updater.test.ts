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

  it("returns ok=false when TOML is missing models table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => ["[metadata]", 'version = "test"'].join("\n"),
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
        text: async () => ['[models."m1"]', "input_cost_per_token = 0.000001"].join("\n"),
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
        text: async () => ['[models."m1"]', "input_cost_per_token = 0.000001"].join("\n"),
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

  it("returns ok=true when TOML parses and write succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          ['[models."m1"]', 'display_name = "Model One"', "input_cost_per_token = 0.000001"].join(
            "\n"
          ),
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
  });

  it("falls back to default error message when write returns ok=false without error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => ['[models."m1"]', "input_cost_per_token = 0.000001"].join("\n"),
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
        text: async () => ['[models."m1"]', "input_cost_per_token = 0.000001"].join("\n"),
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
        text: async () => ['[models."m1"]', "input_cost_per_token = 0.000001"].join("\n"),
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
      text: async () => ['[models."m1"]', "input_cost_per_token = 0.000001"].join("\n"),
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
