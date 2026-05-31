import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/drizzle/db";

vi.mock("@/drizzle/db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

describe("statistics timezone buckets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serializes local SQL buckets as instants in the configured timezone", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce([{ id: 1, name: "alice" }])
      .mockResolvedValueOnce([{ bucket: "2026-05-30 00:00:00" }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          user_name: "alice",
          bucket: "2026-05-30 00:00:00",
          api_calls: "3",
          total_cost: "1.25",
        },
      ]);

    const { getUserStatisticsFromDB } = await import("@/repository/statistics");

    const rows = await getUserStatisticsFromDB("7days", "Asia/Shanghai");

    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].date).toISOString()).toBe("2026-05-29T16:00:00.000Z");
    expect(rows[0].api_calls).toBe(3);
    expect(rows[0].total_cost).toBe("1.25");
  });

  it("keeps thisMonth buckets when postgres returns a short timezone offset", async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce([{ id: 1, name: "alice" }])
      .mockResolvedValueOnce([{ bucket: "2026-05-01 00:00:00-04" }])
      .mockResolvedValueOnce([
        {
          user_id: 1,
          user_name: "alice",
          bucket: "2026-05-01 00:00:00-04",
          api_calls: "4",
          total_cost: "2.50",
        },
      ]);

    const { getUserStatisticsFromDB } = await import("@/repository/statistics");

    const rows = await getUserStatisticsFromDB("thisMonth", "Asia/Shanghai");

    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].date).toISOString()).toBe("2026-04-30T16:00:00.000Z");
    expect(rows[0].api_calls).toBe(4);
    expect(rows[0].total_cost).toBe("2.50");
  });
});
