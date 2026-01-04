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

const findKeyByIdMock = vi.fn();
const updateKeyMock = vi.fn();

vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: vi.fn(async () => 1),
  createKey: vi.fn(async () => ({})),
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

    findKeyByIdMock.mockResolvedValue({
      id: 1,
      userId: 10,
      key: "sk-test",
      name: "k",
      isEnabled: true,
      expiresAt: new Date("2026-01-04T23:59:59.999Z"),
      canLoginWebUi: true,
      limit5hUsd: null,
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

    updateKeyMock.mockResolvedValue({ id: 1 });
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
});
