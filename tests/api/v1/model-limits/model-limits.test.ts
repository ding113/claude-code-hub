import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const listModelGroupLimitsActionMock = vi.hoisted(() => vi.fn());
const upsertModelGroupLimitActionMock = vi.hoisted(() => vi.fn());
const deleteModelGroupLimitActionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/actions/model-limit", () => ({
  listModelGroupLimitsAction: listModelGroupLimitsActionMock,
  upsertModelGroupLimitAction: upsertModelGroupLimitActionMock,
  deleteModelGroupLimitAction: deleteModelGroupLimitActionMock,
}));

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const headers = { Authorization: "Bearer admin-token" };

const limitRow = {
  id: 10,
  subjectType: "user",
  subjectId: 5,
  modelGroupId: 2,
  rpmLimit: null,
  limit5hUsd: null,
  limit5hResetMode: "fixed",
  dailyLimitUsd: 30,
  limitWeeklyUsd: null,
  limitMonthlyUsd: null,
  limitTotalUsd: null,
  limit5hCostResetAt: null,
};

const validUpsertBody = {
  subjectType: "user",
  subjectId: 5,
  modelGroupId: 2,
  dailyLimitUsd: 30,
};

beforeEach(() => {
  validateAuthTokenMock.mockResolvedValue(adminSession);
  listModelGroupLimitsActionMock.mockResolvedValue({ ok: true, data: [limitRow] });
  upsertModelGroupLimitActionMock.mockResolvedValue({ ok: true, data: limitRow });
  deleteModelGroupLimitActionMock.mockResolvedValue({ ok: true, data: undefined });
});

describe("v1 model-limits endpoints (model_group_limits)", () => {
  test("GET lists limits and returns 200 with items", async () => {
    const res = await callV1Route({
      method: "GET",
      pathname: "/api/v1/model-limits?subjectType=user&subjectId=5",
      headers,
    });
    expect(res.response.status).toBe(200);
    expect(res.json).toMatchObject({ items: [{ id: 10, subjectType: "user" }] });
  });

  test("POST upserts a limit and returns 200", async () => {
    const res = await callV1Route({
      method: "POST",
      pathname: "/api/v1/model-limits",
      headers,
      body: validUpsertBody,
    });
    expect(res.response.status).toBe(200);
    // handler destructures the body into positional args: (subjectType, subjectId, groupId, caps)
    expect(upsertModelGroupLimitActionMock).toHaveBeenCalledWith(
      "user",
      5,
      2,
      expect.objectContaining({ dailyLimitUsd: 30 })
    );
  });

  test("DELETE removes a limit and returns 204", async () => {
    const res = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/model-limits/10",
      headers,
    });
    expect(res.response.status).toBe(204);
    expect(deleteModelGroupLimitActionMock).toHaveBeenCalledWith(10);
  });

  describe("request validation (400)", () => {
    test("rejects a missing subjectType", async () => {
      const { subjectType: _omit, ...rest } = validUpsertBody;
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-limits",
        headers,
        body: rest,
      });
      expect(res.response.status).toBe(400);
      expect(upsertModelGroupLimitActionMock).not.toHaveBeenCalled();
    });

    test("rejects an invalid subjectType enum value", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-limits",
        headers,
        body: { ...validUpsertBody, subjectType: "team" },
      });
      expect(res.response.status).toBe(400);
    });

    test("rejects a negative cost limit", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-limits",
        headers,
        body: { ...validUpsertBody, dailyLimitUsd: -1 },
      });
      expect(res.response.status).toBe(400);
    });

    test("rejects unknown keys (strict schema)", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-limits",
        headers,
        body: { ...validUpsertBody, surprise: true },
      });
      expect(res.response.status).toBe(400);
    });

    test("rejects a non-numeric id on delete", async () => {
      const res = await callV1Route({
        method: "DELETE",
        pathname: "/api/v1/model-limits/not-a-number",
        headers,
      });
      expect(res.response.status).toBe(400);
      expect(deleteModelGroupLimitActionMock).not.toHaveBeenCalled();
    });
  });

  describe("action error status mapping", () => {
    test("a not-found action error becomes 404", async () => {
      deleteModelGroupLimitActionMock.mockResolvedValueOnce({ ok: false, error: "限额不存在" });
      const res = await callV1Route({
        method: "DELETE",
        pathname: "/api/v1/model-limits/10",
        headers,
      });
      expect(res.response.status).toBe(404);
    });

    test("a permission action error becomes 403", async () => {
      upsertModelGroupLimitActionMock.mockResolvedValueOnce({ ok: false, error: "无权限操作" });
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-limits",
        headers,
        body: validUpsertBody,
      });
      expect(res.response.status).toBe(403);
    });

    test("any other action error becomes 400", async () => {
      upsertModelGroupLimitActionMock.mockResolvedValueOnce({
        ok: false,
        error: "model group has no members",
      });
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/model-limits",
        headers,
        body: validUpsertBody,
      });
      expect(res.response.status).toBe(400);
    });
  });
});
