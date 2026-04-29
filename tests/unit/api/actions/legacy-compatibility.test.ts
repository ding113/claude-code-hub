import type { AuthSession } from "@/lib/auth";
import { afterEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getUsersMock = vi.hoisted(() => vi.fn());

const adminSession = {
  user: { id: -1, role: "admin", isEnabled: true },
  key: { id: -1, userId: -1, key: "legacy-admin-token", canLoginWebUi: true },
} as AuthSession;

describe("legacy actions API compatibility", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/auth");
    vi.doUnmock("@/actions/users");
    vi.resetModules();
  });

  test("keeps authenticated successful action responses in the legacy ActionResult envelope", async () => {
    vi.resetModules();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getUsersMock.mockResolvedValue([{ id: 1, name: "alice", role: "user" }]);

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/actions/users", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/actions/users")>();
      return { ...actual, getUsers: getUsersMock };
    });

    const route = await import("@/app/api/actions/[...route]/route");
    const response = await route.POST(
      new Request("http://localhost/api/actions/users/getUsers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer legacy-admin-token",
        },
        body: "{}",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Deprecation")).toBe("@1777420800");
    expect(response.headers.get("Sunset")).toBe("Thu, 31 Dec 2026 00:00:00 GMT");
    expect(response.headers.get("Link")).toContain("/api/v1/openapi.json");
    expect(body).toEqual({
      ok: true,
      data: [{ id: 1, name: "alice", role: "user" }],
    });
  }, 20_000);
});
