import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const getTranslationsMock = vi.fn(async () => (key: string) => key);
const getLocaleMock = vi.fn(async () => "en");
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
  getLocale: getLocaleMock,
}));

const resolveSystemTimezoneMock = vi.fn(async () => "Asia/Shanghai");
vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: resolveSystemTimezoneMock,
}));

const updateUserMock = vi.fn();
const createUserMock = vi.fn();
const createKeyMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    createUser: createUserMock,
    updateUser: updateUserMock,
  };
});

vi.mock("@/repository/key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/key")>();
  return {
    ...actual,
    createKey: createKeyMock,
  };
});

describe("editUser: expiresAt 清除应写入数据库更新", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    resolveSystemTimezoneMock.mockResolvedValue("Asia/Shanghai");
    createUserMock.mockResolvedValue({ id: 123, name: "u", role: "user", isEnabled: true });
    createKeyMock.mockResolvedValue({ id: 456, name: "default" });
    updateUserMock.mockResolvedValue({ id: 123 });
  });

  test("addUser 应按系统时区解析 datetime-local fiveHourResetAnchor", async () => {
    const { addUser } = await import("@/actions/users");

    const res = await addUser({
      name: "u",
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: "2026-03-23T12:30",
    });

    expect(res.ok).toBe(true);
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fiveHourResetAnchor: expect.any(Date),
      })
    );

    const createPayload = createUserMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((createPayload.fiveHourResetAnchor as Date).toISOString()).toBe(
      "2026-03-23T04:30:00.000Z"
    );
  });

  test("addUser 应拒绝未来时间的 fiveHourResetAnchor", async () => {
    const { addUser } = await import("@/actions/users");

    const res = await addUser({
      name: "u",
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: "2099-03-23T12:30",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe("FIVE_HOUR_RESET_ANCHOR_MUST_NOT_BE_FUTURE");
    }
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test("createUserOnly 应按系统时区解析 datetime-local fiveHourResetAnchor", async () => {
    const { createUserOnly } = await import("@/actions/users");

    const res = await createUserOnly({
      name: "u",
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: "2026-03-23T12:30",
    });

    expect(res.ok).toBe(true);
    expect(createUserMock).toHaveBeenCalledTimes(1);

    const createPayload = createUserMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((createPayload.fiveHourResetAnchor as Date).toISOString()).toBe(
      "2026-03-23T04:30:00.000Z"
    );
  });

  test("传入 expiresAt=null 应调用 updateUser(..., { expiresAt: null })", async () => {
    const { editUser } = await import("@/actions/users");

    const res = await editUser(123, { expiresAt: null });

    expect(res.ok).toBe(true);
    expect(updateUserMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        expiresAt: null,
      })
    );
  });

  test("editUser 应按系统时区解析 datetime-local fiveHourResetAnchor", async () => {
    const { editUser } = await import("@/actions/users");

    const res = await editUser(123, {
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: "2026-03-23T12:30",
    });

    expect(res.ok).toBe(true);
    expect(updateUserMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        fiveHourResetMode: "fixed",
        fiveHourResetAnchor: expect.any(Date),
      })
    );

    const updatePayload = updateUserMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect((updatePayload.fiveHourResetAnchor as Date).toISOString()).toBe(
      "2026-03-23T04:30:00.000Z"
    );
  });

  test("editUser 应拒绝未来时间的 fiveHourResetAnchor", async () => {
    const { editUser } = await import("@/actions/users");

    const res = await editUser(123, {
      fiveHourResetMode: "fixed",
      fiveHourResetAnchor: "2099-03-23T12:30",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe("FIVE_HOUR_RESET_ANCHOR_MUST_NOT_BE_FUTURE");
    }
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
