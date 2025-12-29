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

const searchUsersForFilterRepositoryMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    searchUsersForFilter: searchUsersForFilterRepositoryMock,
  };
});

describe("searchUsersForFilter (action)", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    searchUsersForFilterRepositoryMock.mockReset();
  });

  test("returns UNAUTHORIZED when session is missing", async () => {
    getSessionMock.mockResolvedValue(null);

    const { searchUsersForFilter } = await import("@/actions/users");

    const result = await searchUsersForFilter();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("UNAUTHORIZED");
    }
  });

  test("returns PERMISSION_DENIED for non-admin user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 123, role: "user" } });

    const { searchUsersForFilter } = await import("@/actions/users");

    const result = await searchUsersForFilter();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PERMISSION_DENIED");
    }
  });

  test("returns users for admin", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    searchUsersForFilterRepositoryMock.mockResolvedValue([{ id: 1, name: "Alice" }]);

    const { searchUsersForFilter } = await import("@/actions/users");

    const result = await searchUsersForFilter("ali");

    expect(searchUsersForFilterRepositoryMock).toHaveBeenCalledWith("ali");
    expect(result).toEqual({ ok: true, data: [{ id: 1, name: "Alice" }] });
  });
});
