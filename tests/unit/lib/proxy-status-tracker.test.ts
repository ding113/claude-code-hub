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

  it("uses a bounded active window and status_code as the active marker", async () => {
    const usersQuery = createDrizzleQuery([]);
    const activeQuery = createDrizzleQuery([]);
    boundary.select.mockReturnValueOnce(usersQuery).mockReturnValueOnce(activeQuery);
    boundary.execute.mockResolvedValueOnce([]);

    const { ProxyStatusTracker } = await import("@/lib/proxy-status-tracker");
    await ProxyStatusTracker.getInstance().getAllUsersStatus();

    const activeWhere = sqlText(activeQuery.trace.where[0]);
    expect(activeWhere).toContain("status_code is null");
    expect(activeWhere).toContain("created_at >= now() - interval '24 hours'");
    expect(activeWhere).toContain("blocked_by");
    expect(activeWhere).toContain("warmup");
  });

  it("selects only finalized latest requests with a deterministic tie-break", async () => {
    const usersQuery = createDrizzleQuery([]);
    const activeQuery = createDrizzleQuery([]);
    boundary.select.mockReturnValueOnce(usersQuery).mockReturnValueOnce(activeQuery);
    boundary.execute.mockResolvedValueOnce([]);

    const { ProxyStatusTracker } = await import("@/lib/proxy-status-tracker");
    await ProxyStatusTracker.getInstance().getAllUsersStatus();

    const latestSql = sqlText(boundary.execute.mock.calls[0]?.[0]);
    expect(latestSql).toContain("mr.status_code is not null");
    expect(latestSql).toContain("order by mr.user_id, mr.updated_at desc nulls last, mr.id desc");
  });

  it("coalesces concurrent calls and caches the response for two seconds", async () => {
    const usersQuery = createDrizzleQuery([]);
    const activeQuery = createDrizzleQuery([]);
    let resolveLatest: ((rows: readonly unknown[]) => void) | undefined;
    boundary.select.mockReturnValueOnce(usersQuery).mockReturnValueOnce(activeQuery);
    boundary.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLatest = resolve;
        })
    );

    const { ProxyStatusTracker } = await import("@/lib/proxy-status-tracker");
    const tracker = ProxyStatusTracker.getInstance();
    const first = tracker.getAllUsersStatus();
    const second = tracker.getAllUsersStatus();
    expect(first).toBe(second);
    resolveLatest?.([]);
    await Promise.all([first, second]);
    expect(boundary.select).toHaveBeenCalledTimes(2);
    expect(boundary.execute).toHaveBeenCalledTimes(1);

    await tracker.getAllUsersStatus();
    expect(boundary.select).toHaveBeenCalledTimes(2);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2001);
    boundary.select
      .mockReturnValueOnce(createDrizzleQuery([]))
      .mockReturnValueOnce(createDrizzleQuery([]));
    boundary.execute.mockResolvedValueOnce([]);
    await tracker.getAllUsersStatus();
    expect(boundary.select).toHaveBeenCalledTimes(4);
    vi.restoreAllMocks();
  });
});
