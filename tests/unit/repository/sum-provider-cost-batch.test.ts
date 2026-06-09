import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const groupByMock = vi.fn();
const whereMock = vi.fn().mockReturnValue({ groupBy: groupByMock });
const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock });
const fromMock = vi.fn().mockReturnValue({ where: whereMock, innerJoin: innerJoinMock });
const selectMock = vi.fn().mockReturnValue({ from: fromMock });

vi.mock("@/drizzle/db", () => ({
  db: {
    get select() {
      return selectMock;
    },
  },
}));

describe("sumProviderCostBatchInTimeRange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    whereMock.mockReturnValue({ groupBy: groupByMock });
    innerJoinMock.mockReturnValue({ where: whereMock });
    fromMock.mockReturnValue({ where: whereMock, innerJoin: innerJoinMock });
    selectMock.mockReturnValue({ from: fromMock });
  });

  it("returns empty map and skips DB when providerIds is empty", async () => {
    const { sumProviderCostBatchInTimeRange } = await import("@/repository/statistics");

    const result = await sumProviderCostBatchInTimeRange(
      [],
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-05-01T05:00:00Z")
    );

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("aggregates SUM per final_provider_id within time range", async () => {
    groupByMock.mockResolvedValueOnce([
      { providerId: 1, total: "3.5" },
      { providerId: 2, total: "0.25" },
    ]);

    const { sumProviderCostBatchInTimeRange } = await import("@/repository/statistics");

    const start = new Date("2026-05-01T00:00:00Z");
    const end = new Date("2026-05-01T05:00:00Z");
    const result = await sumProviderCostBatchInTimeRange([1, 2, 3], start, end);

    expect(result.get(1)).toBeCloseTo(3.5, 10);
    expect(result.get(2)).toBeCloseTo(0.25, 10);
    expect(result.has(3)).toBe(false);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(groupByMock).toHaveBeenCalledTimes(1);
  });

  it("coerces non-numeric DB totals to 0 without throwing", async () => {
    groupByMock.mockResolvedValueOnce([{ providerId: 1, total: null }]);

    const { sumProviderCostBatchInTimeRange } = await import("@/repository/statistics");

    const result = await sumProviderCostBatchInTimeRange(
      [1],
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-05-01T05:00:00Z")
    );

    expect(result.get(1)).toBe(0);
  });

  it("honors per-provider startTime via object-array overload (bug07)", async () => {
    groupByMock.mockResolvedValueOnce([
      { providerId: 1, total: "20" },
      { providerId: 2, total: "50" },
    ]);

    const { sumProviderCostBatchInTimeRange } = await import("@/repository/statistics");

    const endTime = new Date("2026-05-01T05:00:00Z");
    const result = await sumProviderCostBatchInTimeRange(
      [
        { providerId: 1, startTime: new Date("2026-05-01T03:00:00Z") },
        { providerId: 2, startTime: new Date("2026-05-01T00:00:00Z") },
      ],
      endTime
    );

    expect(result.get(1)).toBeCloseTo(20, 10);
    expect(result.get(2)).toBeCloseTo(50, 10);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty map for empty per-provider params without touching DB (bug07)", async () => {
    const { sumProviderCostBatchInTimeRange } = await import("@/repository/statistics");

    const result = await sumProviderCostBatchInTimeRange([], new Date("2026-05-01T05:00:00Z"));

    expect(result.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });

  // review L1: oversized batches must be chunked so a single SQL statement
  // never approaches PostgreSQL's 65535 bind-parameter ceiling. The
  // object-array overload binds 2 parameters per provider (id + start_at),
  // so the realistic safety margin is well below 30k providers — we still
  // chunk well under that to leave room for future schema growth.
  it("chunks legacy overload when providerIds exceeds chunk size and merges results", async () => {
    const total = 2_100; // > 2x default chunk size (1000)
    const ids = Array.from({ length: total }, (_, i) => i + 1);

    // Each chunked query returns a disjoint slice of the totals.
    groupByMock.mockImplementation(() => {
      const callIndex = groupByMock.mock.calls.length - 1; // 0,1,2
      const offset = callIndex * 1000;
      const size = Math.min(1000, total - offset);
      return Promise.resolve(
        Array.from({ length: size }, (_, i) => ({
          providerId: ids[offset + i],
          total: String(offset + i + 1),
        }))
      );
    });

    const { sumProviderCostBatchInTimeRange } = await import("@/repository/statistics");

    const result = await sumProviderCostBatchInTimeRange(
      ids,
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-05-01T05:00:00Z")
    );

    // Expect 3 chunks: 1000 + 1000 + 100
    expect(selectMock).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(total);
    expect(result.get(1)).toBe(1);
    expect(result.get(1000)).toBe(1000);
    expect(result.get(1001)).toBe(1001);
    expect(result.get(2100)).toBe(2100);
  });

  it("chunks object-array overload when params exceeds chunk size and merges results", async () => {
    const total = 2_500;
    const endTime = new Date("2026-05-01T05:00:00Z");
    const params = Array.from({ length: total }, (_, i) => ({
      providerId: i + 1,
      startTime: new Date("2026-05-01T00:00:00Z"),
    }));

    groupByMock.mockImplementation(() => {
      const callIndex = groupByMock.mock.calls.length - 1;
      const offset = callIndex * 1000;
      const size = Math.min(1000, total - offset);
      return Promise.resolve(
        Array.from({ length: size }, (_, i) => ({
          providerId: offset + i + 1,
          total: "2",
        }))
      );
    });

    const { sumProviderCostBatchInTimeRange } = await import("@/repository/statistics");

    const result = await sumProviderCostBatchInTimeRange(params, endTime);

    expect(selectMock).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(total);
    expect(result.get(1)).toBe(2);
    expect(result.get(2500)).toBe(2);
  });

  // review L2: typeof null === "object" used to route a null first element
  // through the new overload and NPE on `.providerId`. The new positive
  // `typeof arg1[0] === "number"` guard makes the legacy branch the only
  // one that consumes numeric inputs; anything else (including the bogus
  // [null]) falls through to the safer object branch which already guards
  // against non-shape elements via the existing length check + map shape.
  it("does not crash when first element is null (defensive against bad inputs)", async () => {
    groupByMock.mockResolvedValueOnce([]);

    const { sumProviderCostBatchInTimeRange } = await import("@/repository/statistics");

    // Cast through unknown because the public types reject this; the guard
    // exists to keep the function from segfaulting if callers ever drift.
    const result = await sumProviderCostBatchInTimeRange(
      [null as unknown as { providerId: number; startTime: Date }],
      new Date("2026-05-01T05:00:00Z")
    );

    expect(result.size).toBe(0);
  });
});
