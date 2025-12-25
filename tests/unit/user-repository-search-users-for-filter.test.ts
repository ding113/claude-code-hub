import { beforeEach, describe, expect, test, vi } from "vitest";

let capturedIlikePattern: unknown;

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    sql: (strings: TemplateStringsArray, ...params: unknown[]) => {
      if (strings.join("").includes("ILIKE")) {
        capturedIlikePattern = params[1];
      }
      return actual.sql(strings, ...params);
    },
  };
});

let resolvedRows: Array<{ id: number; name: string }> = [];

vi.mock("@/drizzle/db", () => {
  const orderByMock = vi.fn(() => Promise.resolve(resolvedRows));
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  return {
    db: {
      select: selectMock,
    },
  };
});

describe("searchUsersForFilter (repository)", () => {
  beforeEach(() => {
    capturedIlikePattern = undefined;
    resolvedRows = [{ id: 1, name: "Alice" }];
  });

  test("returns all users without limit", async () => {
    const { searchUsersForFilter } = await import("@/repository/user");

    const result = await searchUsersForFilter();

    expect(result).toEqual(resolvedRows);
  });

  test("trims search term when building ILIKE pattern", async () => {
    const { searchUsersForFilter } = await import("@/repository/user");

    await searchUsersForFilter("  bob  ");

    expect(capturedIlikePattern).toBe("%bob%");
  });
});
