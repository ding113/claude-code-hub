import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for two production failures in cloud price sync persistence:
 *
 * 1. "Failed to clean up stale cloud prices"
 *    Drizzle expands a plain JS array embedded in sql`` into a tuple
 *    `ANY(($1, $2, ...))`, which PostgreSQL rejects (ANY requires an array).
 *    The fix passes the list as a single array parameter: `ANY($1)`.
 *
 * 2. "Failed to persist cloud pricing catalog"
 *    "Cannot read properties of null (reading 'constructor')" in production:
 *    the providers dict is built with Object.create(null) (cpt-schema), and
 *    drizzle's is() check does Object.getPrototypeOf(value).constructor on
 *    every insert value, which throws for null-prototype objects — leaving
 *    cloud_pricing_catalog empty. The fix normalizes providers to a plain
 *    object and binds refreshed_at as an ISO string with an explicit
 *    ::timestamptz cast (JS Date params were implicated in the ops repro).
 */

const dialect = new PgDialect();

let executedQueries: SQL[] = [];
let insertedValues: Record<string, unknown>[] = [];
let executeResult: unknown = [];

vi.mock("server-only", () => ({}));

vi.mock("@/drizzle/db", () => {
  const execute = vi.fn((query: SQL) => {
    executedQueries.push(query);
    return Promise.resolve(executeResult);
  });
  const tx = {
    execute,
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedValues.push(values);
        return Promise.resolve();
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
  };
  return {
    db: {
      execute,
      transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  executedQueries = [];
  insertedValues = [];
  executeResult = [];
});

describe("deleteCloudPricesNotIn", () => {
  it("binds the keep list as a single array parameter for ANY()", async () => {
    const { deleteCloudPricesNotIn } = await import("@/repository/model-price");
    const keep = ["model-a", "model-b", "model-c"];

    await deleteCloudPricesNotIn(keep);

    expect(executedQueries).toHaveLength(1);
    const query = dialect.sqlToQuery(executedQueries[0]);

    // PostgreSQL rejects ANY(($1, $2, ...)) — the tuple form is the regression
    expect(query.sql).not.toContain("ANY((");
    expect(query.sql).toContain("= ANY($1)");
    expect(query.params).toEqual([keep]);
  });

  it("returns the deleted row count reported by the driver", async () => {
    executeResult = Object.assign([], { count: 42 });
    const { deleteCloudPricesNotIn } = await import("@/repository/model-price");

    await expect(deleteCloudPricesNotIn(["model-a"])).resolves.toBe(42);
  });

  it("skips execution entirely for an empty keep list", async () => {
    const { deleteCloudPricesNotIn } = await import("@/repository/model-price");

    await expect(deleteCloudPricesNotIn([])).resolves.toBe(0);
    expect(executedQueries).toHaveLength(0);
  });
});

describe("upsertCloudPricingCatalog", () => {
  const baseInput = {
    version: "2026-07-06+cvt1",
    currency: "USD",
    providers: { anthropic: { name: "Anthropic" } },
    vendors: [{ vendor: "anthropic", name: "Anthropic", modelCount: 10 }],
    modelCount: 10,
  };

  it("binds refreshedAt as an ISO string with ::timestamptz cast, never a JS Date", async () => {
    const { upsertCloudPricingCatalog } = await import("@/repository/cloud-pricing-catalog");

    await upsertCloudPricingCatalog({
      ...baseInput,
      refreshedAt: "2026-07-06T00:00:00.000Z",
    } as Parameters<typeof upsertCloudPricingCatalog>[0]);

    expect(insertedValues).toHaveLength(1);
    const refreshedAt = insertedValues[0].refreshedAt;

    // JS Date params hit a driver encoding bug in production; must not cross the boundary
    expect(refreshedAt).not.toBeInstanceOf(Date);

    const query = dialect.sqlToQuery(refreshedAt as SQL);
    expect(query.sql).toBe("$1::timestamptz");
    expect(query.params).toEqual(["2026-07-06T00:00:00.000Z"]);
  });

  it("normalizes non-ISO input to a canonical ISO string", async () => {
    const { upsertCloudPricingCatalog } = await import("@/repository/cloud-pricing-catalog");

    await upsertCloudPricingCatalog({
      ...baseInput,
      refreshedAt: "2026-07-06 08:00:00+08:00",
    } as Parameters<typeof upsertCloudPricingCatalog>[0]);

    const query = dialect.sqlToQuery(insertedValues[0].refreshedAt as SQL);
    expect(query.params).toEqual(["2026-07-06T00:00:00.000Z"]);
  });

  it.each([null, "not-a-date"])("stores null when refreshedAt is %s", async (refreshedAt) => {
    const { upsertCloudPricingCatalog } = await import("@/repository/cloud-pricing-catalog");

    await upsertCloudPricingCatalog({
      ...baseInput,
      refreshedAt,
    } as Parameters<typeof upsertCloudPricingCatalog>[0]);

    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0].refreshedAt).toBeNull();
  });

  it("normalizes null-prototype provider maps to plain objects before insert", async () => {
    const { upsertCloudPricingCatalog } = await import("@/repository/cloud-pricing-catalog");
    const providers: Record<string, unknown> = Object.create(null);
    providers.anthropic = { name: "Anthropic" };

    await upsertCloudPricingCatalog({
      ...baseInput,
      providers,
      refreshedAt: null,
    } as Parameters<typeof upsertCloudPricingCatalog>[0]);

    const inserted = insertedValues[0].providers as Record<string, unknown>;
    // drizzle's is() does Object.getPrototypeOf(value).constructor and throws on null prototypes
    expect(Object.getPrototypeOf(inserted)).toBe(Object.prototype);
    expect(inserted).toEqual({ anthropic: { name: "Anthropic" } });
  });

  it("replaces the singleton row inside a transaction", async () => {
    const { upsertCloudPricingCatalog } = await import("@/repository/cloud-pricing-catalog");

    await upsertCloudPricingCatalog({
      ...baseInput,
      refreshedAt: null,
    } as Parameters<typeof upsertCloudPricingCatalog>[0]);

    expect(executedQueries).toHaveLength(1);
    expect(dialect.sqlToQuery(executedQueries[0]).sql).toContain(
      "DELETE FROM cloud_pricing_catalog"
    );
    expect(insertedValues[0]).toMatchObject({
      version: baseInput.version,
      currency: baseInput.currency,
      modelCount: baseInput.modelCount,
    });
  });
});

// sanity: the tuple form drizzle used to generate is exactly what PG rejects
describe("drizzle array embedding (documents the regression)", () => {
  it("plain array interpolation expands to a tuple, sql.param keeps a single array param", () => {
    const names = ["a", "b"];
    const tuple = dialect.sqlToQuery(sql`ANY(${names})`);
    expect(tuple.sql).toBe("ANY(($1, $2))");

    const single = dialect.sqlToQuery(sql`ANY(${sql.param(names)})`);
    expect(single.sql).toBe("ANY($1)");
    expect(single.params).toEqual([names]);
  });
});
