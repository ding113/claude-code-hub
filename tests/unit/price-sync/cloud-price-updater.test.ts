import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudPriceTableResult } from "@/lib/price-sync/cloud-price-table";
import { logger } from "@/lib/logger";
import {
  syncCloudPriceTableToDatabase,
  requestCloudPriceTableSync,
} from "@/lib/price-sync/cloud-price-updater";
import { AsyncTaskManager } from "@/lib/async-task-manager";
import { processPriceTableInternal } from "@/actions/model-prices";

const asyncTasks: Promise<void>[] = [];

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    getActiveTasks: vi.fn(() => []),
    register: vi.fn((_taskId: string, promise: Promise<void>) => {
      asyncTasks.push(promise);
      return new AbortController();
    }),
  },
}));

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

describe("syncCloudPriceTableToDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asyncTasks.splice(0, asyncTasks.length);
    vi.unstubAllGlobals();
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

    vi.mocked(processPriceTableInternal).mockResolvedValue({
      ok: false,
      error: "write failed",
    } as unknown as CloudPriceTableResult<unknown>);

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

    vi.mocked(processPriceTableInternal).mockResolvedValue({
      ok: true,
      data: undefined,
    } as unknown as CloudPriceTableResult<unknown>);

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

    const result = await syncCloudPriceTableToDatabase();
    expect(result.ok).toBe(true);
    expect(processPriceTableInternal).toHaveBeenCalledTimes(1);
  });
});

describe("requestCloudPriceTableSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asyncTasks.splice(0, asyncTasks.length);
    vi.unstubAllGlobals();
    delete (globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_LAST_AT__?: number })
      .__CCH_CLOUD_PRICE_SYNC_LAST_AT__;
  });

  it("does nothing when same task is already active", () => {
    vi.mocked(AsyncTaskManager.getActiveTasks).mockReturnValue([
      { taskId: "cloud-price-table-sync" },
    ] as any);

    requestCloudPriceTableSync({ reason: "missing-model", throttleMs: 0 });

    expect(AsyncTaskManager.register).not.toHaveBeenCalled();
  });

  it("throttles when called within throttle window", () => {
    (
      globalThis as unknown as { __CCH_CLOUD_PRICE_SYNC_LAST_AT__?: number }
    ).__CCH_CLOUD_PRICE_SYNC_LAST_AT__ = Date.now();

    requestCloudPriceTableSync({ reason: "missing-model", throttleMs: 60_000 });

    expect(AsyncTaskManager.register).not.toHaveBeenCalled();
  });

  it("registers a task and updates throttle timestamp after completion", async () => {
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

    requestCloudPriceTableSync({ reason: "missing-model", throttleMs: 0 });

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
    expect(vi.mocked(logger.info)).toHaveBeenCalled();
    expect(typeof g.__CCH_CLOUD_PRICE_SYNC_LAST_AT__).toBe("number");
  });

  it("logs warn when sync task fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "server error",
      }))
    );

    requestCloudPriceTableSync({ reason: "scheduled", throttleMs: 0 });
    await Promise.all(asyncTasks.splice(0, asyncTasks.length));

    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });
});
