import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ count: 0 })),
}));

vi.mock("@/drizzle/db", () => ({
  db: dbMock,
}));

function sqlToString(sqlObject: unknown): string {
  return (sqlObject as SQL).toQuery({
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (num: number) => `$${num}`,
    escapeString: (value: string) => `'${value}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  }).sql;
}

describe("deleteCloudPricesNotIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders keep model names as a PostgreSQL array instead of a tuple", async () => {
    const { deleteCloudPricesNotIn } = await import("@/repository/model-price");

    await deleteCloudPricesNotIn(["model-a", "model-b"]);

    expect(dbMock.execute).toHaveBeenCalledTimes(1);
    const query = dbMock.execute.mock.calls[0]?.[0];
    const text = sqlToString(query).replace(/\s+/g, " ").toLowerCase();
    expect(text).toContain("any(array[");
    expect(text).not.toContain("any((");
  });
});
