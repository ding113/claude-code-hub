import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ fromTables: [] as unknown[] }));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: vi.fn(() => {
      const query: any = Promise.resolve([
        { requestCount: 4, totalCost: "1", avgDuration: "10", errorCount: 0 },
      ]);
      query.from = vi.fn((table: unknown) => {
        captured.fromTables.push(table);
        return query;
      });
      query.where = vi.fn(() => query);
      return query;
    }),
  },
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
}));

import { messageRequest, usageLedger } from "@/drizzle/schema";
import { getOverviewMetricsWithComparison } from "@/repository/overview";

describe("getOverviewMetricsWithComparison data sources", () => {
  it("counts recent-minute requests from message_request so in-flight requests are included", async () => {
    const result = await getOverviewMetricsWithComparison(7);

    // today and yesterday aggregates stay on usage_ledger; the recent-minute count reads live rows.
    expect(captured.fromTables).toEqual([usageLedger, usageLedger, messageRequest]);
    expect(result.recentMinuteRequests).toBe(4);
  });
});
