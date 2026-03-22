import { beforeEach, describe, expect, test, vi } from "vitest";

const searchUsersMock = vi.fn();
const validateAuthTokenMock = vi.fn();
const runWithAuthSessionMock = vi.fn();

vi.mock("@/actions/users", () => ({
  getUsers: vi.fn(),
  getUsersBatch: vi.fn(),
  searchUsers: searchUsersMock,
  addUser: vi.fn(),
  editUser: vi.fn(),
  removeUser: vi.fn(),
  getUserLimitUsage: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    AUTH_COOKIE_NAME: "auth-token",
    validateAuthToken: validateAuthTokenMock,
    runWithAuthSession: runWithAuthSessionMock,
  };
});

describe("users searchUsers route compatibility", () => {
  beforeEach(() => {
    vi.resetModules();
    searchUsersMock.mockReset();
    validateAuthTokenMock.mockReset();
    runWithAuthSessionMock.mockReset();

    validateAuthTokenMock.mockResolvedValue({
      user: { id: 1, role: "admin" },
      key: { canLoginWebUi: true },
    });
    runWithAuthSessionMock.mockImplementation(async (_session, callback) => callback());
    searchUsersMock.mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: "Alice" }],
    });
  });

  test("falls back to trimmed query when searchTerm is blank", async () => {
    const { POST } = await import("@/app/api/actions/[...route]/route");

    const response = await POST(
      new Request("http://localhost/api/actions/users/searchUsers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
          cookie: "auth-token=test-token",
        },
        body: JSON.stringify({
          searchTerm: "   ",
          query: "  alice  ",
          keyword: "bob",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(searchUsersMock).toHaveBeenCalledWith("alice");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: [{ id: 1, name: "Alice" }],
    });
  });
});
