import type { AuthSession } from "@/lib/auth";
import { encodeCursor } from "@/lib/api/v1/_shared/pagination";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getAuditLogsBatchMock = vi.hoisted(() => vi.fn());
const getAuditLogDetailMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/audit-logs", () => ({
  getAuditLogsBatch: getAuditLogsBatchMock,
  getAuditLogDetail: getAuditLogDetailMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    actionCategory: "provider",
    actionType: "update",
    targetType: "provider",
    targetId: "7",
    targetName: "primary",
    beforeValue: { name: "old" },
    afterValue: { name: "new" },
    operatorUserId: 1,
    operatorUserName: "admin",
    operatorKeyId: 2,
    operatorKeyName: "admin-key",
    operatorIp: "127.0.0.1",
    userAgent: "vitest",
    success: true,
    errorMessage: null,
    createdAt: new Date("2026-04-28T00:00:00.000Z"),
    ...overrides,
  };
}

describe("v1 audit log endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getAuditLogsBatchMock.mockResolvedValue({
      ok: true,
      data: {
        rows: [auditRow()],
        nextCursor: { createdAt: "2026-04-27T00:00:00.000Z", id: 10 },
      },
    });
    getAuditLogDetailMock.mockResolvedValue({ ok: true, data: auditRow() });
  });

  test("lists audit logs with cursor filters and reads detail", async () => {
    const cursor = encodeCursor({ createdAt: "2026-04-29T00:00:00.000Z", id: 12 });
    const list = await callV1Route({
      method: "GET",
      pathname:
        `/api/v1/audit-logs?cursor=${cursor}&limit=10&category=provider&success=true` +
        "&from=2026-04-01T00:00:00.000Z&to=2026-04-28T00:00:00.000Z",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(list.response.status).toBe(200);
    expect(list.json).toMatchObject({
      items: [{ id: 11, actionCategory: "provider", createdAt: "2026-04-28T00:00:00.000Z" }],
      pageInfo: {
        hasMore: true,
        limit: 10,
        nextCursor: expect.any(String),
      },
    });
    expect(getAuditLogsBatchMock).toHaveBeenCalledWith({
      filter: {
        category: "provider",
        success: true,
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-28T00:00:00.000Z",
      },
      cursor: { createdAt: "2026-04-29T00:00:00.000Z", id: 12 },
      pageSize: 10,
    });

    const detail = await callV1Route({
      method: "GET",
      pathname: "/api/v1/audit-logs/11",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(detail.response.status).toBe(200);
    expect(detail.json).toMatchObject({ id: 11, operatorUserName: "admin" });
  });

  test("returns problem+json for invalid cursor and missing detail", async () => {
    const invalid = await callV1Route({
      method: "GET",
      pathname: "/api/v1/audit-logs?cursor=not-base64",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.json).toMatchObject({ errorCode: "audit_log.invalid_cursor" });

    getAuditLogDetailMock.mockResolvedValueOnce({ ok: true, data: null });
    const missing = await callV1Route({
      method: "GET",
      pathname: "/api/v1/audit-logs/404",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.json).toMatchObject({ errorCode: "audit_log.not_found" });
  });

  test("documents audit log REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/audit-logs");
    expect(doc.paths).toHaveProperty("/api/v1/audit-logs/{id}");
  });
});
