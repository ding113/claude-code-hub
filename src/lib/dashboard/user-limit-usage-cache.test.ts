import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearUsageCache,
  getSharedUserLimitUsage,
  peekCachedUserLimitUsage,
} from "./user-limit-usage-cache";

const { getUserAllLimitUsageMock } = vi.hoisted(() => ({
  getUserAllLimitUsageMock: vi.fn(),
}));

vi.mock("@/actions/users", () => ({
  getUserAllLimitUsage: getUserAllLimitUsageMock,
}));

const usagePayload = {
  limit5h: { usage: 1, limit: 10 },
  limitDaily: { usage: 2, limit: 20 },
  limitWeekly: { usage: 3, limit: 30 },
  limitMonthly: { usage: 4, limit: 40 },
  limitTotal: { usage: 5, limit: 50 },
};

describe("user-limit-usage-cache", () => {
  beforeEach(() => {
    clearUsageCache();
    getUserAllLimitUsageMock.mockReset();
  });

  test("deduplicates concurrent requests for the same user", async () => {
    let resolveRequest: ((value: { ok: true; data: typeof usagePayload }) => void) | undefined;

    getUserAllLimitUsageMock.mockImplementation(
      () =>
        new Promise<{ ok: true; data: typeof usagePayload }>((resolve) => {
          resolveRequest = resolve;
        })
    );

    const first = getSharedUserLimitUsage(7);
    const second = getSharedUserLimitUsage(7);

    expect(getUserAllLimitUsageMock).toHaveBeenCalledTimes(1);

    resolveRequest?.({ ok: true, data: usagePayload });

    await expect(first).resolves.toEqual(usagePayload);
    await expect(second).resolves.toEqual(usagePayload);
    expect(peekCachedUserLimitUsage(7)).toEqual(usagePayload);
  });

  test("returns fresh cached data without hitting the action again", async () => {
    getUserAllLimitUsageMock.mockResolvedValue({ ok: true, data: usagePayload });

    await expect(getSharedUserLimitUsage(9)).resolves.toEqual(usagePayload);
    await expect(getSharedUserLimitUsage(9)).resolves.toEqual(usagePayload);

    expect(getUserAllLimitUsageMock).toHaveBeenCalledTimes(1);
  });
});
