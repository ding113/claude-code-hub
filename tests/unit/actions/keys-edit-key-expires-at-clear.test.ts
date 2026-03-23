import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const getTranslationsMock = vi.fn(async () => (key: string) => key);
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
}));

const resolveSystemTimezoneMock = vi.fn(async () => "Asia/Shanghai");
vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: resolveSystemTimezoneMock,
}));

const syncUserProviderGroupFromKeysMock = vi.fn(async () => {});
vi.mock("@/actions/users", () => ({
  syncUserProviderGroupFromKeys: syncUserProviderGroupFromKeysMock,
}));

const findKeyByIdMock = vi.fn();
const updateKeyMock = vi.fn();
const createKeyMock = vi.fn();

vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: vi.fn(async () => 1),
  createKey: createKeyMock,
  deleteKey: vi.fn(async () => true),
  findActiveKeyByUserIdAndName: vi.fn(async () => null),
  findKeyById: findKeyByIdMock,
  findKeyList: vi.fn(async () => []),
  findKeysWithStatistics: vi.fn(async () => []),
  updateKey: updateKeyMock,
}));

const findUserByIdMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    findUserById: findUserByIdMock,
  };
});

describe("editKey: expiresAt 清除/不更新语义", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    resolveSystemTimezoneMock.mockResolvedValue("Asia/Shanghai");
    syncUserProviderGroupFromKeysMock.mockResolvedValue(undefined);

    findKeyByIdMock.mockResolvedValue({
      id: 1,
      userId: 10,
      key: "sk-test",
      name: "k",
      isEnabled: true,
      expiresAt: new Date("2026-01-04T23:59:59.999Z"),
      canLoginWebUi: true,
      limit5hUsd: null,
      fiveHourResetMode: "rolling",
      fiveHourResetAnchor: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: 0,
      providerGroup: "default",
      cacheTtlPreference: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    findUserByIdMock.mockResolvedValue({
      id: 10,
      name: "u",
      description: "",
      role: "user",
      rpm: null,
      dailyQuota: null,
      providerGroup: "default",
      tags: [],
      limit5hUsd: null,
      fiveHourResetMode: "rolling",
      fiveHourResetAnchor: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: null,
      isEnabled: true,
      expiresAt: null,
      allowedClients: [],
      allowedModels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    createKeyMock.mockResolvedValue({ id: 2 });
    updateKeyMock.mockResolvedValue({ id: 1 });
  });

  test("addKey 应按系统时区解析 datetime-local fiveHourResetAnchor", async () => {
    const { addKey } = await import("@/actions/keys");

    const res = await addKey({
      userId: 10,
      name: "new-key",
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: "2026-03-23T12:30",
    });

    expect(res.ok).toBe(true);
    expect(createKeyMock).toHaveBeenCalledTimes(1);

    const createPayload = createKeyMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createPayload.five_hour_reset_anchor).toBeInstanceOf(Date);
    expect((createPayload.five_hour_reset_anchor as Date).toISOString()).toBe(
      "2026-03-23T04:30:00.000Z"
    );
  });

  test("addKey 应拒绝未来时间的 fiveHourResetAnchor", async () => {
    const { addKey } = await import("@/actions/keys");

    const res = await addKey({
      userId: 10,
      name: "new-key",
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: "2099-03-23T12:30",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe("FIVE_HOUR_RESET_ANCHOR_MUST_NOT_BE_FUTURE");
    }
    expect(createKeyMock).not.toHaveBeenCalled();
  });

  test("不携带 expiresAt 字段时不应更新 expires_at", async () => {
    const { editKey } = await import("@/actions/keys");

    const res = await editKey(1, { name: "k2" });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);

    const updatePayload = updateKeyMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.hasOwn(updatePayload, "expires_at")).toBe(false);
  });

  test("携带 expiresAt=undefined 时应清除 expires_at（写入 null）", async () => {
    const { editKey } = await import("@/actions/keys");

    const res = await editKey(1, { name: "k2", expiresAt: undefined });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);
    expect(updateKeyMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        expires_at: null,
      })
    );
  });

  test('携带 expiresAt="" 时应清除 expires_at（写入 null）', async () => {
    const { editKey } = await import("@/actions/keys");

    const res = await editKey(1, { name: "k2", expiresAt: "" });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);
    expect(updateKeyMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        expires_at: null,
      })
    );
  });

  test("携带 expiresAt=YYYY-MM-DD 时应写入对应 Date", async () => {
    const { editKey } = await import("@/actions/keys");

    const res = await editKey(1, { name: "k2", expiresAt: "2026-01-04" });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);

    const updatePayload = updateKeyMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updatePayload.expires_at).toBeInstanceOf(Date);
    expect(Number.isNaN((updatePayload.expires_at as Date).getTime())).toBe(false);
  });

  test("携带非法 expiresAt 字符串应返回 INVALID_FORMAT", async () => {
    const { editKey } = await import("@/actions/keys");

    const res = await editKey(1, { name: "k2", expiresAt: "not-a-date" });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe("INVALID_FORMAT");
    }
  });

  test("不携带 fiveHourReset 字段时不应更新对应字段", async () => {
    const { editKey } = await import("@/actions/keys");

    const res = await editKey(1, { name: "k2" });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);

    const updatePayload = updateKeyMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.hasOwn(updatePayload, "five_hour_reset_mode")).toBe(false);
    expect(Object.hasOwn(updatePayload, "five_hour_reset_anchor")).toBe(false);
  });

  test('携带 fiveHourResetAnchor="" 时应清除 anchor（写入 null）', async () => {
    const { editKey } = await import("@/actions/keys");

    const res = await editKey(1, {
      name: "k2",
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: "",
    });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);
    expect(updateKeyMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        five_hour_reset_mode: "fixed",
        five_hour_reset_anchor: null,
      })
    );
  });

  test("携带 fiveHourResetAnchor=datetime-local 时应按系统时区写入精确 UTC Date", async () => {
    const { editKey } = await import("@/actions/keys");

    const res = await editKey(1, {
      name: "k2",
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: "2026-03-23T12:30",
    });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);

    const updatePayload = updateKeyMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updatePayload.five_hour_reset_mode).toBe("fixed");
    expect(updatePayload.five_hour_reset_anchor).toBeInstanceOf(Date);
    expect((updatePayload.five_hour_reset_anchor as Date).toISOString()).toBe(
      "2026-03-23T04:30:00.000Z"
    );
  });

  test("携带未来时间的 fiveHourResetAnchor 时应拒绝更新", async () => {
    const { editKey } = await import("@/actions/keys");

    const res = await editKey(1, {
      name: "k2",
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: "2099-03-23T12:30",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe("FIVE_HOUR_RESET_ANCHOR_MUST_NOT_BE_FUTURE");
    }
    expect(updateKeyMock).not.toHaveBeenCalled();
  });

  test("携带 fiveHourResetAnchor=Date 时应写入对应 Date", async () => {
    const { editKey } = await import("@/actions/keys");

    const res = await editKey(1, {
      name: "k2",
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: new Date("2026-03-23T04:30:00.000Z"),
    });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);

    const updatePayload = updateKeyMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updatePayload.five_hour_reset_mode).toBe("fixed");
    expect(updatePayload.five_hour_reset_anchor).toBeInstanceOf(Date);
    expect(Number.isNaN((updatePayload.five_hour_reset_anchor as Date).getTime())).toBe(false);
  });
});
