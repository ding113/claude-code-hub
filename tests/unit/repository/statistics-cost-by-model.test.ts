import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

function makeDbMock(opts: {
  totalRows: Row[];
  keyRows?: Row[];
  onWhere?: (conditions: unknown) => void;
}) {
  return {
    db: {
      select: vi.fn((projection: Row) => {
        const isKeyLookup = projection && "key" in projection;
        const rows = isKeyLookup ? (opts.keyRows ?? []) : opts.totalRows;
        // A drizzle-like query builder: a Promise (awaitable) with chainable methods.
        const result = Promise.resolve(rows) as Promise<Row[]> & Record<string, unknown>;
        result.from = () => result;
        result.where = (conditions: unknown) => {
          if (!isKeyLookup) opts.onWhere?.(conditions);
          return result;
        };
        result.limit = () => Promise.resolve(rows);
        return result;
      }),
    },
  };
}

describe("sumUserCostByModelInTimeRange", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("returns the summed cost for a user/model within the time range", async () => {
    let captured: unknown;
    vi.doMock("@/drizzle/db", () =>
      makeDbMock({ totalRows: [{ total: 12.5 }], onWhere: (c) => (captured = c) })
    );

    const { sumUserCostByModelInTimeRange } = await import("@/repository/statistics");
    const result = await sumUserCostByModelInTimeRange(
      1,
      "claude-opus-4",
      new Date("2026-05-01"),
      new Date("2026-05-20")
    );

    expect(result).toBe(12.5);
    expect(captured).toBeDefined(); // a filtered WHERE clause was applied
  });

  it("returns 0 when no rows match", async () => {
    vi.doMock("@/drizzle/db", () => makeDbMock({ totalRows: [{ total: 0 }] }));

    const { sumUserCostByModelInTimeRange } = await import("@/repository/statistics");
    const result = await sumUserCostByModelInTimeRange(
      99,
      "claude-haiku-4.5",
      new Date("2026-05-01"),
      new Date("2026-05-20")
    );

    expect(result).toBe(0);
  });
});

describe("sumKeyCostByModelInTimeRange", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("resolves the key string then sums cost for that key/model", async () => {
    vi.doMock("@/drizzle/db", () =>
      makeDbMock({ totalRows: [{ total: 7.25 }], keyRows: [{ key: "khash-1" }] })
    );

    const { sumKeyCostByModelInTimeRange } = await import("@/repository/statistics");
    const result = await sumKeyCostByModelInTimeRange(
      5,
      "claude-opus-4",
      new Date("2026-05-01"),
      new Date("2026-05-20")
    );

    expect(result).toBe(7.25);
  });

  it("returns 0 when the key id cannot be resolved", async () => {
    vi.doMock("@/drizzle/db", () => makeDbMock({ totalRows: [{ total: 7.25 }], keyRows: [] }));

    const { sumKeyCostByModelInTimeRange } = await import("@/repository/statistics");
    const result = await sumKeyCostByModelInTimeRange(
      404,
      "claude-opus-4",
      new Date("2026-05-01"),
      new Date("2026-05-20")
    );

    expect(result).toBe(0);
  });
});
