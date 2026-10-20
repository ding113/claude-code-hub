import type { StoredCostBreakdown } from "@/types/cost-breakdown";
import type { HedgeLoserBilling } from "@/types/cost-breakdown";
import { CasingCache } from "drizzle-orm/casing";
import { afterEach, describe, expect, it, vi } from "vitest";

type SqlQuery = {
  toQuery: (config: {
    escapeName: (name: string) => string;
    escapeParam: (index: number) => string;
    escapeString: (value: string) => string;
    casing: CasingCache;
    paramStartIndex: { value: number };
  }) => { sql: string; params: unknown[] };
};

function isSqlQuery(value: unknown): value is SqlQuery {
  return typeof value === "object" && value !== null && "toQuery" in value;
}

function renderSql(value: unknown) {
  if (!isSqlQuery(value)) throw new TypeError("Expected a Drizzle SQL query");
  return value.toQuery({
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index}`,
    escapeString: (text) => `'${text}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  });
}

function installCostBoundary(whereImplementation: (condition: unknown) => Promise<unknown[]>) {
  const where = vi.fn(whereImplementation);
  const set = vi.fn((_patch: Record<string, unknown>) => ({ where }));
  const update = vi.fn((_table: unknown) => ({ set }));
  vi.doMock("@/drizzle/db", () => ({
    db: { update, select: vi.fn(), execute: vi.fn() },
    getMessageWriterDb: vi.fn(() => ({ update: vi.fn(), execute: vi.fn() })),
  }));
  vi.doMock("@/lib/config/env.schema", () => ({
    getEnvConfig: vi.fn(() => ({ MESSAGE_REQUEST_WRITE_MODE: "sync" as const })),
    isDevelopment: vi.fn(() => false),
  }));
  vi.doMock("@/lib/redis", () => ({ getRedisClient: vi.fn(() => null) }));
  return { set, update, where };
}

const BREAKDOWN = {
  input: "0.04",
  output: "0.06",
  cache_creation: "0",
  cache_read: "0",
  base_total: "0.10",
  provider_multiplier: 1,
  group_multiplier: 1,
  total: "0.10",
} satisfies StoredCostBreakdown;

const LOSER = {
  providerId: 12,
  providerName: "hedge-loser",
  attemptNumber: 2,
  costUsd: "0.015",
  inputTokens: 40,
  outputTokens: 5,
} satisfies HedgeLoserBilling;

describe("message terminal cost accounting", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@/drizzle/db");
    vi.doUnmock("@/lib/config/env.schema");
    vi.doUnmock("@/lib/redis");
  });

  it("replaces winner cost with winner plus the authoritative loser sum", async () => {
    vi.resetModules();
    const { set, update } = installCostBoundary(async () => []);
    const { updateMessageRequestWinnerCost } = await import("@/repository/message");

    await updateMessageRequestWinnerCost(901, "0.1", BREAKDOWN);

    const patch = set.mock.calls[0]?.[0];
    if (!patch) throw new Error("Winner update did not reach the DB boundary");
    const costSql = renderSql(patch.costUsd);
    expect(costSql.sql).toMatch(/jsonb_array_elements.*hedge_losers/i);
    expect(costSql.sql).toMatch(/SUM.*costUsd/i);
    expect(costSql.params).toContain("0.100000000000000");
    expect(patch.costBreakdown).toEqual(BREAKDOWN);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("guards a loser write by provider and attempt while atomically adding its cost", async () => {
    vi.resetModules();
    const { set, update, where } = installCostBoundary(async () => []);
    const { addMessageRequestHedgeLoserCost } = await import("@/repository/message");

    await addMessageRequestHedgeLoserCost(902, "0.015", LOSER);

    const patch = set.mock.calls[0]?.[0];
    if (!patch) throw new Error("Loser update did not reach the DB boundary");
    const costSql = renderSql(patch.costUsd);
    const losersSql = renderSql(patch.hedgeLosers);
    const guardSql = renderSql(where.mock.calls[0]?.[0]);
    expect(costSql.sql).toContain("COALESCE");
    expect(costSql.params).toContain("0.015000000000000");
    expect(losersSql.params).toContain(JSON.stringify([LOSER]));
    expect(guardSql.sql).toContain("@>");
    expect(guardSql.params).toContain(
      JSON.stringify([{ providerId: LOSER.providerId, attemptNumber: LOSER.attemptNumber }])
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("retries an ambiguous loser write without changing its idempotency key", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    let attempts = 0;
    const boundary = installCostBoundary(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient writer failure");
      return [];
    });
    const { addMessageRequestHedgeLoserCost } = await import("@/repository/message");

    const completion = addMessageRequestHedgeLoserCost(903, "0.015", LOSER);
    await vi.advanceTimersByTimeAsync(150);
    await completion;

    expect(boundary.update).toHaveBeenCalledTimes(3);
    const guards = boundary.where.mock.calls.map(([condition]) => renderSql(condition).params);
    expect(new Set(guards.map((params) => JSON.stringify(params))).size).toBe(1);
  });
});
