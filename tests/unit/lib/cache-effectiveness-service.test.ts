import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
  },
}));

function sqlToString(sqlObject: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);
    if (typeof node === "string") return node;
    if (typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(walk).join("");
    if (typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.value !== undefined) return walk(record.value);
      if (record.queryChunks !== undefined) return walk(record.queryChunks);
    }
    return "";
  };

  return walk(sqlObject);
}

describe("aggregateCacheEffectiveness", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
    mocks.transaction.mockImplementation(async (callback: (tx: object) => unknown) =>
      callback({ execute: mocks.execute })
    );
  });

  it("skips without touching cursor when another replica owns the advisory lock", async () => {
    mocks.execute.mockResolvedValueOnce([{ acquired: false }]);
    const { aggregateCacheEffectiveness } = await import("@/lib/cache-effectiveness/service");

    const result = await aggregateCacheEffectiveness();

    expect(result.skipped).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("advances the persistent cursor even when the aggregation window is empty", async () => {
    mocks.execute
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cursor_at: new Date("2026-07-30T11:00:00.000Z") }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { aggregateCacheEffectiveness } = await import("@/lib/cache-effectiveness/service");

    const result = await aggregateCacheEffectiveness();

    expect(result).toMatchObject({ groupsWritten: 0, skipped: false });
    expect(mocks.execute).toHaveBeenCalledTimes(5);
    expect(sqlToString(mocks.execute.mock.calls[4]?.[0])).toContain(
      "UPDATE background_task_cursor"
    );
  });

  it("uses an idempotent unique window upsert before advancing the cursor", async () => {
    mocks.execute
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cursor_at: new Date("2026-07-30T11:00:00.000Z") }])
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([]);
    const { aggregateCacheEffectiveness } = await import("@/lib/cache-effectiveness/service");

    const result = await aggregateCacheEffectiveness();

    expect(result.groupsWritten).toBe(1);
    const aggregateSql = sqlToString(mocks.execute.mock.calls[3]?.[0]);
    expect(aggregateSql).toContain(
      "ON CONFLICT (provider_id, model, cache_ttl_bucket, window_start, window_end)"
    );
  });

  it("rejects the transaction when cursor persistence fails", async () => {
    mocks.execute
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cursor_at: new Date("2026-07-30T11:00:00.000Z") }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("cursor write failed"));
    const { aggregateCacheEffectiveness } = await import("@/lib/cache-effectiveness/service");

    await expect(aggregateCacheEffectiveness()).rejects.toThrow("cursor write failed");
  });
});
