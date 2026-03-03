import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("ProxyStatusTracker", () => {
  const selectMock = vi.fn();
  const warnMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.resetModules();

    selectMock.mockReset();
    warnMock.mockReset();

    let callCount = 0;
    selectMock.mockImplementation(() => ({
      from: () => ({
        where: async () => {
          callCount++;
          if (callCount === 1) {
            return [{ id: 1, name: "u1" }];
          }
          throw new Error("db down");
        },
      }),
    }));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(),
      },
    }));

    vi.doMock("@/lib/logger", () => ({
      logger: {
        warn: warnMock,
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("刷新失败时应返回过期缓存（避免 dashboard 轮询错误风暴）", async () => {
    const { ProxyStatusTracker } = await import("@/lib/proxy-status-tracker");

    const tracker = new ProxyStatusTracker();
    vi.spyOn(tracker as any, "loadActiveRequests").mockResolvedValue([]);
    vi.spyOn(tracker as any, "loadLastRequests").mockResolvedValue([]);

    const first = await tracker.getAllUsersStatus();
    expect(first.users.map((u) => u.userName)).toEqual(["u1"]);

    // 5000ms TTL 过期后，第二次刷新失败应降级为返回缓存
    vi.advanceTimersByTime(6000);

    const second = await tracker.getAllUsersStatus();
    expect(second.users.map((u) => u.userName)).toEqual(["u1"]);

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});
