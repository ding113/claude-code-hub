import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  delete: vi.fn(),
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

  it("renders keep model names without tuple ANY syntax", async () => {
    const whereMock = vi.fn(function (this: unknown, condition: unknown) {
      (whereMock as unknown as { condition: unknown }).condition = condition;
      return this;
    });
    const returningMock = vi.fn(async () => [{ id: 1 }, { id: 2 }]);
    dbMock.delete.mockReturnValue({
      where: whereMock,
      returning: returningMock,
    });
    const { deleteCloudPricesNotIn } = await import("@/repository/model-price");

    const removed = await deleteCloudPricesNotIn(["model-a", "model-b"]);

    expect(removed).toBe(2);
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledTimes(1);
    expect(returningMock).toHaveBeenCalledWith({ id: expect.anything() });
    const text = sqlToString((whereMock as unknown as { condition: unknown }).condition)
      .replace(/\s+/g, " ")
      .toLowerCase();
    expect(text).toContain("not in ($2, $3)");
    expect(text).not.toContain("any((");
  });
});
