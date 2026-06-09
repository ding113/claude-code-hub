import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const listUserGroupsMock = vi.hoisted(() => vi.fn());
const createUserGroupMock = vi.hoisted(() => vi.fn());
const updateUserGroupMock = vi.hoisted(() => vi.fn());
const deleteUserGroupMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/actions/user-group", () => ({
  listUserGroups: listUserGroupsMock,
  createUserGroup: createUserGroupMock,
  updateUserGroup: updateUserGroupMock,
  deleteUserGroup: deleteUserGroupMock,
}));

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const headers = { Authorization: "Bearer admin-token" };

const userGroup = {
  id: 3,
  tag: "team-a",
  name: "Team A",
  description: null,
  memberCount: 5,
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z",
};

beforeEach(() => {
  validateAuthTokenMock.mockResolvedValue(adminSession);
  listUserGroupsMock.mockResolvedValue({ ok: true, data: [userGroup] });
  createUserGroupMock.mockResolvedValue({ ok: true, data: userGroup });
  updateUserGroupMock.mockResolvedValue({ ok: true, data: { ...userGroup, name: "Team A2" } });
  deleteUserGroupMock.mockResolvedValue({ ok: true, data: undefined });
});

describe("v1 user-groups endpoints", () => {
  test("GET lists groups and returns 200 with items", async () => {
    const res = await callV1Route({ method: "GET", pathname: "/api/v1/user-groups", headers });
    expect(res.response.status).toBe(200);
    expect(res.json).toMatchObject({ items: [{ id: 3, tag: "team-a" }] });
  });

  test("POST creates a group and returns 201 with a Location header", async () => {
    const res = await callV1Route({
      method: "POST",
      pathname: "/api/v1/user-groups",
      headers,
      body: { tag: "team-a", name: "Team A" },
    });
    expect(res.response.status).toBe(201);
    expect(res.response.headers.get("Location")).toBe("/api/v1/resources/user-groups/3");
    expect(createUserGroupMock).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "team-a", name: "Team A" })
    );
  });

  test("PATCH updates a group and returns 200", async () => {
    const res = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/user-groups/3",
      headers,
      body: { name: "Team A2" },
    });
    expect(res.response.status).toBe(200);
    expect(updateUserGroupMock).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ name: "Team A2" })
    );
  });

  test("DELETE removes a group and returns 204", async () => {
    const res = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/user-groups/3",
      headers,
    });
    expect(res.response.status).toBe(204);
    expect(deleteUserGroupMock).toHaveBeenCalledWith(3);
  });

  describe("request validation (400)", () => {
    test("rejects an empty tag", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/user-groups",
        headers,
        body: { tag: "" },
      });
      expect(res.response.status).toBe(400);
      expect(createUserGroupMock).not.toHaveBeenCalled();
    });

    test("rejects unknown keys (strict schema)", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/user-groups",
        headers,
        body: { tag: "team-a", surprise: true },
      });
      expect(res.response.status).toBe(400);
    });

    test("rejects a non-numeric id", async () => {
      const res = await callV1Route({
        method: "DELETE",
        pathname: "/api/v1/user-groups/not-a-number",
        headers,
      });
      expect(res.response.status).toBe(400);
      expect(deleteUserGroupMock).not.toHaveBeenCalled();
    });
  });

  describe("action error status mapping", () => {
    test("a not_found action error becomes 404", async () => {
      deleteUserGroupMock.mockResolvedValueOnce({ ok: false, error: "user group not found" });
      const res = await callV1Route({
        method: "DELETE",
        pathname: "/api/v1/user-groups/3",
        headers,
      });
      expect(res.response.status).toBe(404);
    });

    test("a permission action error becomes 403", async () => {
      createUserGroupMock.mockResolvedValueOnce({ ok: false, error: "无权限操作" });
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/user-groups",
        headers,
        body: { tag: "team-a" },
      });
      expect(res.response.status).toBe(403);
    });

    test("any other action error becomes 400", async () => {
      createUserGroupMock.mockResolvedValueOnce({ ok: false, error: "tag already registered" });
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/user-groups",
        headers,
        body: { tag: "team-a" },
      });
      expect(res.response.status).toBe(400);
    });
  });
});
