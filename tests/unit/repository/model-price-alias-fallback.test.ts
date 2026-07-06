import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the alias fallback query in findLatestPriceByModel.
 *
 * Drizzle expands a plain JS array embedded in sql`` into a tuple
 * `($1, $2, ...)`, so `model_name = ANY(...)`, `aliases ?| ...` and the
 * `::text[]` cast all received invalid SQL and the fallback failed on every
 * call (swallowed as "Failed to query latest price by model", returning null).
 * The candidate list must be bound as a single array parameter.
 */

const dialect = new PgDialect();

let executedQueries: SQL[] = [];

vi.mock("server-only", () => ({}));

vi.mock("@/drizzle/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(() => Promise.resolve([]));
  return {
    db: {
      select: vi.fn(() => chain),
      execute: vi.fn((query: SQL) => {
        executedQueries.push(query);
        return Promise.resolve([]);
      }),
    },
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  executedQueries = [];
});

describe("findLatestPriceByModel alias fallback", () => {
  it("binds candidate names as single array parameters, never tuples", async () => {
    const { findLatestPriceByModel } = await import("@/repository/model-price");

    await findLatestPriceByModel("anthropic/claude-sonnet-5");

    expect(executedQueries).toHaveLength(1);
    const query = dialect.sqlToQuery(executedQueries[0]);

    // tuple expansion is what PostgreSQL rejects
    expect(query.sql).not.toContain("ANY((");
    expect(query.sql).toMatch(/= ANY\(\$\d+\)/);
    // jsonb ?| requires a text[] operand, not a tuple
    expect(query.sql).toMatch(/\?\| \$\d+/);
    expect(query.sql).toMatch(/\$\d+::text\[\]/);

    // the candidate list (derived name variants) must arrive as array parameters
    const arrayParams = query.params.filter((p) => Array.isArray(p));
    expect(arrayParams.length).toBeGreaterThan(0);
    for (const param of arrayParams) {
      expect(param).toContain("claude-sonnet-5");
    }
  });
});
