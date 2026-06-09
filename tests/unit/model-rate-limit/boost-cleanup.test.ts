import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/repository/quota-boost", () => ({ deleteExpiredQuotaBoostGrants: vi.fn() }));

import { logger } from "@/lib/logger";
import { startBoostExpiryCleanup } from "@/lib/model-rate-limit/boost-cleanup";
import { deleteExpiredQuotaBoostGrants } from "@/repository/quota-boost";

const deleteExpired = vi.mocked(deleteExpiredQuotaBoostGrants);
const startedGuard = globalThis as unknown as { __CCH_BOOST_EXPIRY_CLEANUP_STARTED__?: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  startedGuard.__CCH_BOOST_EXPIRY_CLEANUP_STARTED__ = undefined;
  deleteExpired.mockResolvedValue(0);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("startBoostExpiryCleanup", () => {
  it("starts the scheduler and marks the idempotency guard", () => {
    startBoostExpiryCleanup();
    expect(startedGuard.__CCH_BOOST_EXPIRY_CLEANUP_STARTED__).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      "[BoostCleanup] Quota boost expiry cleanup scheduler started",
      { intervalSeconds: 60 }
    );
  });

  it("is idempotent: a second call does not register a second timer", () => {
    startBoostExpiryCleanup();
    startBoostExpiryCleanup();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("deletes expired grants every 60s and logs when rows were removed", async () => {
    deleteExpired.mockResolvedValue(3);
    startBoostExpiryCleanup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deleteExpired).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("[BoostCleanup] Deleted expired quota boost grants", {
      count: 3,
    });
  });

  it("does not log a deletion when nothing expired", async () => {
    deleteExpired.mockResolvedValue(0);
    startBoostExpiryCleanup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deleteExpired).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalledWith(
      "[BoostCleanup] Deleted expired quota boost grants",
      expect.anything()
    );
  });

  it("warns and keeps running when a cleanup tick rejects", async () => {
    deleteExpired.mockRejectedValueOnce(new Error("db down")).mockResolvedValue(1);
    startBoostExpiryCleanup();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(logger.warn).toHaveBeenCalledWith(
      "[BoostCleanup] Failed to delete expired quota boost grants",
      { error: "db down" }
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(deleteExpired).toHaveBeenCalledTimes(2);
  });
});
