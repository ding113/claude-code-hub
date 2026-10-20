import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const txExecute = vi.fn();
  const transaction = vi.fn(async (callback: (tx: { execute: typeof txExecute }) => unknown) =>
    callback({ execute: txExecute })
  );
  return { txExecute, transaction };
});

vi.mock("server-only", () => ({}));
vi.mock("@/drizzle/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { aggregateCacheEffectiveness } from "@/lib/cache-effectiveness/service";

function containsDateParameter(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value instanceof Date) return true;
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => containsDateParameter(item, seen));
}

describe("aggregateCacheEffectiveness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
    mocks.txExecute.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("writes the safe delayed window and returns inserted group count", async () => {
    mocks.txExecute
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([{ last_end: null }])
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

    const result = await aggregateCacheEffectiveness();

    expect(result).toMatchObject({
      windowStart: new Date("2026-08-02T11:00:00.000Z"),
      windowEnd: new Date("2026-08-02T11:45:00.000Z"),
      groupsWritten: 2,
      skipped: false,
    });
    expect(mocks.txExecute).toHaveBeenCalledTimes(3);
    const aggregateSql = mocks.txExecute.mock.calls[2]?.[0];
    expect(containsDateParameter(aggregateSql)).toBe(false);
    expect(JSON.stringify(aggregateSql)).toContain("GREATEST");
  });

  test("skips when another replica owns the advisory lock", async () => {
    mocks.txExecute.mockResolvedValueOnce([{ acquired: false }]);

    await expect(aggregateCacheEffectiveness()).resolves.toMatchObject({
      groupsWritten: 0,
      skipped: true,
      windowStart: null,
      windowEnd: null,
    });
    expect(mocks.txExecute).toHaveBeenCalledTimes(1);
  });

  test("skips when the persisted window already reaches the safe end", async () => {
    mocks.txExecute
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([{ last_end: "2026-08-02T11:50:00.000Z" }]);

    await expect(aggregateCacheEffectiveness()).resolves.toMatchObject({
      groupsWritten: 0,
      skipped: true,
      windowStart: new Date("2026-08-02T11:50:00.000Z"),
      windowEnd: new Date("2026-08-02T11:45:00.000Z"),
    });
    expect(mocks.txExecute).toHaveBeenCalledTimes(2);
  });
});
