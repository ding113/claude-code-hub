import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => {
  const state = {
    keyRows: [] as Array<{ key: string }>,
    aggregateRow: {} as Record<string, string>,
    selections: [] as Array<Record<string, unknown>>,
  };
  const select = vi.fn((fields: Record<string, unknown>) => {
    state.selections.push(fields);
    const isKeyLookup = Object.keys(fields).length === 1 && "key" in fields;
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() =>
      isKeyLookup
        ? { limit: vi.fn(async () => state.keyRows) }
        : Promise.resolve([state.aggregateRow])
    );
    return chain;
  });
  return { state, db: { select } };
});

vi.mock("@/drizzle/db", () => ({ db: dbMocks.db }));
vi.mock("@/lib/utils/timezone", () => ({ resolveSystemTimezone: vi.fn(async () => "UTC") }));

import { sumEntityCostInTimeRanges } from "@/repository/statistics";

const ranges = [
  {
    startTime: new Date("2026-03-01T00:00:00.000Z"),
    endTime: new Date("2026-03-01T05:00:00.000Z"),
  },
  {
    startTime: new Date("2026-02-01T00:00:00.000Z"),
    endTime: new Date("2026-03-02T00:00:00.000Z"),
  },
];

describe("sumEntityCostInTimeRanges", () => {
  beforeEach(() => {
    dbMocks.state.selections.length = 0;
    dbMocks.state.keyRows = [];
    dbMocks.state.aggregateRow = { r0: "1.5", r1: "7.25" };
  });

  it("selects one FILTER aggregate per range and returns sums in input order", async () => {
    const sums = await sumEntityCostInTimeRanges("provider", 3, ranges);

    expect(sums).toEqual([1.5, 7.25]);
    const aggregate = dbMocks.state.selections.at(-1) ?? {};
    expect(Object.keys(aggregate)).toEqual(["r0", "r1"]);
  });

  it("resolves key ids to key strings and returns zeros for unknown keys", async () => {
    await expect(sumEntityCostInTimeRanges("key", 404, ranges)).resolves.toEqual([0, 0]);

    dbMocks.state.keyRows = [{ key: "sk-known" }];
    await expect(sumEntityCostInTimeRanges("key", 405, ranges)).resolves.toEqual([1.5, 7.25]);
  });

  it("treats missing aggregate columns as zero and short-circuits empty input", async () => {
    dbMocks.state.aggregateRow = {};
    await expect(sumEntityCostInTimeRanges("user", 1, ranges)).resolves.toEqual([0, 0]);

    const before = dbMocks.state.selections.length;
    await expect(sumEntityCostInTimeRanges("user", 1, [])).resolves.toEqual([]);
    expect(dbMocks.state.selections.length).toBe(before);
  });
});
