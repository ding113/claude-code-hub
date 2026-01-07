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

const updateUserMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    updateUser: updateUserMock,
  };
});

describe("editUser: expiresAt 清除应写入数据库更新", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    updateUserMock.mockResolvedValue({ id: 123 });
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
});
