import { describe, expect, test, vi } from "vitest";

function createThenableQuery<T>(result: T) {
  const query: any = Promise.resolve(result);
  query.from = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  return query;
}

describe("usage log model filter options", () => {
  test("getUsedModels omits empty or blank model names", async () => {
    vi.resetModules();

    const selectDistinctMock = vi.fn(() =>
      createThenableQuery([
        { model: "" },
        { model: "   " },
        { model: "claude-sonnet-4-5" },
        { model: "gpt-4o" },
        { model: null },
      ])
    );

    vi.doMock("@/drizzle/db", () => ({
      db: { selectDistinct: selectDistinctMock },
    }));

    const { getUsedModels } = await import("@/repository/usage-logs");

    await expect(getUsedModels()).resolves.toEqual(["claude-sonnet-4-5", "gpt-4o"]);
  });
});
