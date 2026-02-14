import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuotaCostRanges } from "@/repository/statistics";

function concatSqlStringChunks(sqlObject: unknown): string {
  if (!sqlObject || typeof sqlObject !== "object") return "";

  const maybeSql = sqlObject as { queryChunks?: unknown[] };
  if (!Array.isArray(maybeSql.queryChunks)) return "";

  return maybeSql.queryChunks.filter((chunk): chunk is string => typeof chunk === "string").join("");
}

function createRanges(): QuotaCostRanges {
  const base = new Date("2026-01-01T00:00:00.000Z");
  const plus = (ms: number) => new Date(base.getTime() + ms);

  return {
    range5h: { startTime: base, endTime: plus(5 * 60 * 60 * 1000) },
    rangeDaily: { startTime: base, endTime: plus(24 * 60 * 60 * 1000) },
    rangeWeekly: { startTime: base, endTime: plus(7 * 24 * 60 * 60 * 1000) },
    rangeMonthly: { startTime: base, endTime: plus(30 * 24 * 60 * 60 * 1000) },
  };
}

describe("sumUserQuotaCosts & sumKeyQuotaCostsById - all-time query support", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sumUserQuotaCosts should treat Infinity as all-time (no created_at cutoff)", async () => {
    const ranges = createRanges();
    let capturedAndArgs: unknown[] | undefined;
    let capturedSelectFields: Record<string, unknown> | undefined;

    vi.doMock("drizzle-orm", async () => {
      const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
      return {
        ...actual,
        and: (...args: unknown[]) => {
          capturedAndArgs = args;
          return (actual as any).and(...args);
        },
      };
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
          capturedSelectFields = fields;
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                {
                  cost5h: "0",
                  costDaily: "0",
                  costWeekly: "0",
                  costMonthly: "0",
                  costTotal: "0",
                },
              ]),
            }),
          };
        }),
      },
    }));

    const { sumUserQuotaCosts } = await import("@/repository/statistics");
    await sumUserQuotaCosts(1, ranges, Infinity);

    expect(capturedAndArgs).toBeDefined();
    expect(capturedAndArgs?.length).toBe(4);

    expect(capturedSelectFields).toBeDefined();
    expect(concatSqlStringChunks(capturedSelectFields?.costTotal)).not.toContain("FILTER");
  });

  it("sumKeyQuotaCostsById should treat Infinity as all-time (no created_at cutoff)", async () => {
    const ranges = createRanges();
    let capturedAndArgs: unknown[] | undefined;
    let capturedSelectFields: Record<string, unknown> | undefined;

    vi.doMock("drizzle-orm", async () => {
      const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
      return {
        ...actual,
        and: (...args: unknown[]) => {
          capturedAndArgs = args;
          return (actual as any).and(...args);
        },
      };
    });

    let selectCallIndex = 0;
    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
          selectCallIndex += 1;
          const currentCallIndex = selectCallIndex;

          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (currentCallIndex === 1) {
                  return {
                    limit: vi.fn().mockResolvedValue([{ key: "test-key-string" }]),
                  };
                }

                capturedSelectFields = fields;
                return Promise.resolve([
                  {
                    cost5h: "0",
                    costDaily: "0",
                    costWeekly: "0",
                    costMonthly: "0",
                    costTotal: "0",
                  },
                ]);
              }),
            }),
          };
        }),
      },
    }));

    const { sumKeyQuotaCostsById } = await import("@/repository/statistics");
    await sumKeyQuotaCostsById(123, ranges, Infinity);

    expect(capturedAndArgs).toBeDefined();
    expect(capturedAndArgs?.length).toBe(4);

    expect(capturedSelectFields).toBeDefined();
    expect(concatSqlStringChunks(capturedSelectFields?.costTotal)).not.toContain("FILTER");
  });
});

