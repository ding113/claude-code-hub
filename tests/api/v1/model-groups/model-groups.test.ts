import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const listModelGroupsMock = vi.hoisted(() => vi.fn());
const createModelGroupMock = vi.hoisted(() => vi.fn());
const getModelGroupByIdMock = vi.hoisted(() => vi.fn());
const updateModelGroupMock = vi.hoisted(() => vi.fn());
const deleteModelGroupMock = vi.hoisted(() => vi.fn());
const addModelGroupMemberMock = vi.hoisted(() => vi.fn());
const removeModelGroupMemberMock = vi.hoisted(() => vi.fn());
const createSingletonModelGroupMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/actions/model-group", () => ({
  listModelGroups: listModelGroupsMock,
  createModelGroup: createModelGroupMock,
  getModelGroupById: getModelGroupByIdMock,
  updateModelGroup: updateModelGroupMock,
  deleteModelGroup: deleteModelGroupMock,
  addModelGroupMember: addModelGroupMemberMock,
  removeModelGroupMember: removeModelGroupMemberMock,
  createSingletonModelGroup: createSingletonModelGroupMock,
}));

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const headers = { Authorization: "Bearer admin-token" };

const group = {
  id: 2,
  name: "g-opus",
  description: null,
  isSingleton: false,
  members: ["claude-opus-4"],
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z",
};

beforeEach(() => {
  validateAuthTokenMock.mockResolvedValue(adminSession);
  listModelGroupsMock.mockResolvedValue({ ok: true, data: [group] });
  createModelGroupMock.mockResolvedValue({ ok: true, data: group });
  getModelGroupByIdMock.mockResolvedValue({ ok: true, data: group });
  updateModelGroupMock.mockResolvedValue({ ok: true, data: { ...group, name: "g-opus-2" } });
  deleteModelGroupMock.mockResolvedValue({ ok: true, data: undefined });
  addModelGroupMemberMock.mockResolvedValue({ ok: true, data: undefined });
  removeModelGroupMemberMock.mockResolvedValue({ ok: true, data: undefined });
  createSingletonModelGroupMock.mockResolvedValue({ ok: true, data: group });
});

describe("v1 model-groups endpoints", () => {
  test("GET lists groups and returns 200 with items", async () => {
    const res = await callV1Route({ method: "GET", pathname: "/api/v1/model-groups", headers });
    expect(res.response.status).toBe(200);
    expect(res.json).toMatchObject({ items: [{ id: 2, name: "g-opus" }] });
  });

  test("POST creates a group and returns 201 with a Location header", async () => {
    const res = await callV1Route({
      method: "POST",
      pathname: "/api/v1/model-groups",
      headers,
      body: { name: "g-opus" },
    });
    expect(res.response.status).toBe(201);
    expect(res.response.headers.get("Location")).toBe("/api/v1/resources/model-groups/2");
    expect(createModelGroupMock).toHaveBeenCalled();
  });

  test("GET by id returns 200", async () => {
    const res = await callV1Route({
      method: "GET",
      pathname: "/api/v1/model-groups/2",
      headers,
    });
    expect(res.response.status).toBe(200);
    expect(res.json).toMatchObject({ id: 2 });
  });

  test("PATCH updates a group and returns 200", async () => {
    const res = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/model-groups/2",
      headers,
      body: { name: "g-opus-2" },
    });
    expect(res.response.status).toBe(200);
    expect(updateModelGroupMock).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ name: "g-opus-2" })
    );
  });

  test("DELETE removes a group and returns 204", async () => {
    const res = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/model-groups/2",
      headers,
    });
    expect(res.response.status).toBe(204);
    expect(deleteModelGroupMock).toHaveBeenCalledWith(2);
  });

  test("POST member adds a model and returns 204", async () => {
    const res = await callV1Route({
      method: "POST",
      pathname: "/api/v1/model-groups/2/members",
      headers,
      body: { model: "claude-opus-4" },
    });
    expect(res.response.status).toBe(204);
    expect(addModelGroupMemberMock).toHaveBeenCalledWith(2, "claude-opus-4");
  });

  test("DELETE member removes a model and returns 204", async () => {
    const res = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/model-groups/2/members?model=claude-opus-4",
      headers,
    });
    expect(res.response.status).toBe(204);
    expect(removeModelGroupMemberMock).toHaveBeenCalledWith(2, "claude-opus-4");
  });

  test("POST singleton creates a single-model group and returns 201", async () => {
    const res = await callV1Route({
      method: "POST",
      pathname: "/api/v1/model-groups/singleton",
      headers,
      body: { model: "claude-opus-4" },
    });
    expect(res.response.status).toBe(201);
    expect(createSingletonModelGroupMock).toHaveBeenCalled();
  });

  describe("request validation (400)", () => {
    test("rejects an empty name", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-groups",
        headers,
        body: { name: "" },
      });
      expect(res.response.status).toBe(400);
      expect(createModelGroupMock).not.toHaveBeenCalled();
    });

    test("rejects unknown keys (strict schema)", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-groups",
        headers,
        body: { name: "g", surprise: true },
      });
      expect(res.response.status).toBe(400);
    });

    test("rejects a non-numeric id", async () => {
      const res = await callV1Route({
        method: "GET",
        pathname: "/api/v1/model-groups/not-a-number",
        headers,
      });
      expect(res.response.status).toBe(400);
      expect(getModelGroupByIdMock).not.toHaveBeenCalled();
    });

    test("rejects a member body without a model", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-groups/2/members",
        headers,
        body: {},
      });
      expect(res.response.status).toBe(400);
      expect(addModelGroupMemberMock).not.toHaveBeenCalled();
    });
  });

  describe("action error status mapping", () => {
    test("a MEMBER_CONFLICT action error becomes 409 (global mutual exclusion, D6)", async () => {
      addModelGroupMemberMock.mockResolvedValueOnce({
        ok: false,
        errorCode: "MEMBER_CONFLICT",
        error: "model already belongs to another group",
      });
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-groups/2/members",
        headers,
        body: { model: "claude-opus-4" },
      });
      expect(res.response.status).toBe(409);
    });

    test("a not_found action error becomes 404", async () => {
      getModelGroupByIdMock.mockResolvedValueOnce({ ok: false, error: "group not found" });
      const res = await callV1Route({
        method: "GET",
        pathname: "/api/v1/model-groups/2",
        headers,
      });
      expect(res.response.status).toBe(404);
    });

    test("a permission action error becomes 403", async () => {
      createModelGroupMock.mockResolvedValueOnce({ ok: false, error: "无权限操作" });
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-groups",
        headers,
        body: { name: "g-opus" },
      });
      expect(res.response.status).toBe(403);
    });

    test("any other action error becomes 400", async () => {
      createModelGroupMock.mockResolvedValueOnce({ ok: false, error: "name already taken" });
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-groups",
        headers,
        body: { name: "g-opus" },
      });
      expect(res.response.status).toBe(400);
    });
  });
});
