import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const listQuotaBoostGrantsActionMock = vi.hoisted(() => vi.fn());
const createQuotaBoostGrantActionMock = vi.hoisted(() => vi.fn());
const deleteQuotaBoostGrantActionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/actions/quota-boost", () => ({
  listQuotaBoostGrantsAction: listQuotaBoostGrantsActionMock,
  createQuotaBoostGrantAction: createQuotaBoostGrantActionMock,
  deleteQuotaBoostGrantAction: deleteQuotaBoostGrantActionMock,
}));

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const headers = { Authorization: "Bearer admin-token" };

const grant = {
  id: 777,
  userId: 1,
  modelGroupId: 2,
  window: "daily",
  amountUsd: "10",
  validFrom: "2026-06-01T00:00:00.000Z",
  validTo: "2026-06-02T00:00:00.000Z",
  note: null,
  createdBy: 1,
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z",
};

const validBody = {
  userId: 1,
  modelGroupId: 2,
  window: "daily",
  amountUsd: 10,
  validFrom: "2026-06-01T00:00:00.000Z",
  validTo: "2026-06-02T00:00:00.000Z",
};

beforeEach(() => {
  validateAuthTokenMock.mockResolvedValue(adminSession);
  listQuotaBoostGrantsActionMock.mockResolvedValue({ ok: true, data: [grant] });
  createQuotaBoostGrantActionMock.mockResolvedValue({ ok: true, data: grant });
  deleteQuotaBoostGrantActionMock.mockResolvedValue({ ok: true, data: undefined });
});

describe("v1 quota-boosts endpoints", () => {
  test("POST creates a grant and returns 201 with a Location header", async () => {
    const res = await callV1Route({
      method: "POST",
      pathname: "/api/v1/quota-boosts",
      headers,
      body: validBody,
    });

    expect(res.response.status).toBe(201);
    expect(res.response.headers.get("Location")).toBe("/api/v1/quota-boosts/777");
    expect(createQuotaBoostGrantActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, modelGroupId: 2, window: "daily", amountUsd: 10 })
    );
  });

  test("GET lists grants and returns 200 with items", async () => {
    const res = await callV1Route({
      method: "GET",
      pathname: "/api/v1/quota-boosts?userId=1",
      headers,
    });

    expect(res.response.status).toBe(200);
    expect(res.json).toMatchObject({ items: [{ id: 777 }] });
  });

  test("DELETE removes a grant and returns 204", async () => {
    const res = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/quota-boosts/777",
      headers,
    });

    expect(res.response.status).toBe(204);
    expect(deleteQuotaBoostGrantActionMock).toHaveBeenCalledWith(777);
  });

  describe("request validation (400)", () => {
    test("rejects validFrom without a timezone offset", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/quota-boosts",
        headers,
        body: { ...validBody, validFrom: "2026-06-01T00:00:00" },
      });
      expect(res.response.status).toBe(400);
      expect(createQuotaBoostGrantActionMock).not.toHaveBeenCalled();
    });

    test("rejects validTo that is not after validFrom", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/quota-boosts",
        headers,
        body: { ...validBody, validTo: validBody.validFrom },
      });
      expect(res.response.status).toBe(400);
      expect(createQuotaBoostGrantActionMock).not.toHaveBeenCalled();
    });

    test("rejects a non-positive amount", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/quota-boosts",
        headers,
        body: { ...validBody, amountUsd: -5 },
      });
      expect(res.response.status).toBe(400);
    });

    test("rejects unknown keys (strict schema)", async () => {
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/quota-boosts",
        headers,
        body: { ...validBody, surprise: true },
      });
      expect(res.response.status).toBe(400);
    });

    test("rejects a non-numeric id on delete", async () => {
      const res = await callV1Route({
        method: "DELETE",
        pathname: "/api/v1/quota-boosts/not-a-number",
        headers,
      });
      expect(res.response.status).toBe(400);
      expect(deleteQuotaBoostGrantActionMock).not.toHaveBeenCalled();
    });
  });

  // The quota-boosts API maps action failures to 400/403/404 only; there is no 409
  // conflict path (D11 governs in-memory future-grant activation, not a write conflict).
  describe("action error status mapping", () => {
    test("a not_found action error becomes 404", async () => {
      deleteQuotaBoostGrantActionMock.mockResolvedValueOnce({
        ok: false,
        error: "grant not_found",
      });
      const res = await callV1Route({
        method: "DELETE",
        pathname: "/api/v1/quota-boosts/777",
        headers,
      });
      expect(res.response.status).toBe(404);
    });

    test("a forbidden action error becomes 403", async () => {
      createQuotaBoostGrantActionMock.mockResolvedValueOnce({
        ok: false,
        error: "forbidden: personal users only",
      });
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/quota-boosts",
        headers,
        body: validBody,
      });
      expect(res.response.status).toBe(403);
    });

    test("any other action error becomes 400", async () => {
      createQuotaBoostGrantActionMock.mockResolvedValueOnce({
        ok: false,
        error: "model group has no members",
      });
      const res = await callV1Route({
        method: "POST",
        pathname: "/api/v1/quota-boosts",
        headers,
        body: validBody,
      });
      expect(res.response.status).toBe(400);
    });
  });
});
