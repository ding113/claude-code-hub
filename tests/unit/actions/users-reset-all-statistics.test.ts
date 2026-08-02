import { beforeEach, describe, expect, test, vi } from "vitest";
import { ERROR_CODES } from "@/lib/utils/error-messages";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUserById: vi.fn(),
  findKeyList: vi.fn(),
  getRedisClient: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  getLocale: vi.fn(async () => "en"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/repository/user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/repository/user")>()),
  findUserById: mocks.findUserById,
}));
vi.mock("@/repository/key", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/repository/key")>()),
  findKeyList: mocks.findKeyList,
}));
vi.mock("@/lib/redis", () => ({ getRedisClient: mocks.getRedisClient }));
vi.mock("@/lib/user-statistics-reset/reset-queue", () => ({
  enqueueUserStatisticsReset: mocks.enqueue,
}));

const queuedReset = {
  resetId: "00000000-0000-4000-8000-000000000001",
  userId: 123,
  status: "queued" as const,
  requestedAt: "2026-08-02T12:00:00.000Z",
  startedAt: null,
  completedAt: null,
  deletedMessageRequests: 0,
  deletedUsageLedger: 0,
  errorCode: null,
};

describe("resetUserAllStatistics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: 1, role: "admin" } });
    mocks.findUserById.mockResolvedValue({
      id: 123,
      limit5hUsd: null,
      limit5hResetMode: "rolling",
    });
    mocks.findKeyList.mockResolvedValue([]);
    mocks.getRedisClient.mockReturnValue({ status: "ready" });
    mocks.enqueue.mockResolvedValue(queuedReset);
  });

  test("returns PERMISSION_DENIED for non-admin users", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 1, role: "user" } });
    const { resetUserAllStatistics } = await import("@/actions/users");

    const result = await resetUserAllStatistics(123);

    expect(result).toMatchObject({ ok: false, errorCode: ERROR_CODES.PERMISSION_DENIED });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  test("returns NOT_FOUND for a missing user", async () => {
    mocks.findUserById.mockResolvedValue(null);
    const { resetUserAllStatistics } = await import("@/actions/users");

    const result = await resetUserAllStatistics(123);

    expect(result).toMatchObject({ ok: false, errorCode: ERROR_CODES.NOT_FOUND });
  });

  test("delegates cold Redis readiness handling to the reset queue", async () => {
    mocks.findUserById.mockResolvedValue({
      id: 123,
      limit5hUsd: 10,
      limit5hResetMode: "fixed",
    });
    mocks.getRedisClient.mockReturnValue({ status: "connecting" });
    const { resetUserAllStatistics } = await import("@/actions/users");

    const result = await resetUserAllStatistics(123);

    expect(result).toEqual({ ok: true, data: queuedReset });
    expect(mocks.getRedisClient).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith(123, { fixed5hKeyIds: [] });
  });

  test("queues the reset and returns its durable status", async () => {
    const { resetUserAllStatistics } = await import("@/actions/users");

    const result = await resetUserAllStatistics(123);

    expect(result).toEqual({ ok: true, data: queuedReset });
    expect(mocks.enqueue).toHaveBeenCalledWith(123, {
      fixed5hKeyIds: [],
    });
  });

  test("maps queue failures to a retryable dependency error", async () => {
    mocks.enqueue.mockRejectedValue(new Error("redis unavailable"));
    const { resetUserAllStatistics } = await import("@/actions/users");

    const result = await resetUserAllStatistics(123);

    expect(result).toMatchObject({ ok: false, errorCode: ERROR_CODES.CONNECTION_FAILED });
  });
});
