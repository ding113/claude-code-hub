import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDrizzleQuery, sqlText } from "../repository/message-query-test-support";

const boundary = vi.hoisted(() => ({
  select: vi.fn<(selection?: unknown) => unknown>(),
  execute: vi.fn<(query: unknown) => Promise<readonly unknown[]>>(),
}));

vi.mock("@/drizzle/db", () => ({
  db: { select: boundary.select, execute: boundary.execute },
}));

describe("ProxyStatusTracker", () => {
  beforeEach(() => {
    vi.resetModules();
    boundary.select.mockReset();
    boundary.execute.mockReset();
  });

  it("excludes Replay audit rows from active and last-request status", async () => {
    const usersQuery = createDrizzleQuery([{ id: 7, name: "Ada" }]);
    const activeQuery = createDrizzleQuery([]);
    boundary.select.mockReturnValueOnce(usersQuery).mockReturnValueOnce(activeQuery);
    boundary.execute.mockResolvedValueOnce([]);

    const { ProxyStatusTracker } = await import("@/lib/proxy-status-tracker");
    await expect(ProxyStatusTracker.getInstance().getAllUsersStatus()).resolves.toEqual({
      users: [
        {
          userId: 7,
          userName: "Ada",
          activeCount: 0,
          activeRequests: [],
          lastRequest: null,
        },
      ],
    });

    expect(sqlText(activeQuery.trace.where[0])).toContain("is_replay = false");
    expect(sqlText(boundary.execute.mock.calls[0]?.[0])).toContain("mr.is_replay = false");
  });
});
