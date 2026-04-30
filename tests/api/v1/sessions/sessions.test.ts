import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getActiveSessionsMock = vi.hoisted(() => vi.fn());
const getAllSessionsMock = vi.hoisted(() => vi.fn());
const getSessionMessagesMock = vi.hoisted(() => vi.fn());
const hasSessionMessagesMock = vi.hoisted(() => vi.fn());
const getSessionDetailsMock = vi.hoisted(() => vi.fn());
const getSessionRequestsMock = vi.hoisted(() => vi.fn());
const terminateActiveSessionMock = vi.hoisted(() => vi.fn());
const terminateActiveSessionsBatchMock = vi.hoisted(() => vi.fn());
const getSessionOriginChainMock = vi.hoisted(() => vi.fn());
const getSessionResponseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});
vi.mock("@/actions/active-sessions", () => ({
  getActiveSessions: getActiveSessionsMock,
  getAllSessions: getAllSessionsMock,
  getSessionMessages: getSessionMessagesMock,
  hasSessionMessages: hasSessionMessagesMock,
  getSessionDetails: getSessionDetailsMock,
  getSessionRequests: getSessionRequestsMock,
  terminateActiveSession: terminateActiveSessionMock,
  terminateActiveSessionsBatch: terminateActiveSessionsBatchMock,
}));
vi.mock("@/actions/session-origin-chain", () => ({
  getSessionOriginChain: getSessionOriginChainMock,
}));
vi.mock("@/actions/session-response", () => ({ getSessionResponse: getSessionResponseMock }));

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

describe("v1 session endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getActiveSessionsMock.mockResolvedValue({ ok: true, data: [{ sessionId: "s1" }] });
    getAllSessionsMock.mockResolvedValue({
      ok: true,
      data: {
        active: [{ sessionId: "s1" }],
        inactive: [],
        totalActive: 1,
        totalInactive: 0,
        hasMoreActive: false,
        hasMoreInactive: false,
      },
    });
    getSessionMessagesMock.mockResolvedValue({ ok: true, data: [{ role: "user" }] });
    hasSessionMessagesMock.mockResolvedValue({ ok: true, data: true });
    getSessionDetailsMock.mockResolvedValue({ ok: true, data: { currentSequence: 2 } });
    getSessionRequestsMock.mockResolvedValue({
      ok: true,
      data: { requests: [{ sequence: 1 }], total: 1, hasMore: false },
    });
    terminateActiveSessionMock.mockResolvedValue({ ok: true });
    terminateActiveSessionsBatchMock.mockResolvedValue({
      ok: true,
      data: {
        successCount: 1,
        failedCount: 0,
        allowedFailedCount: 0,
        unauthorizedCount: 0,
        missingCount: 0,
        requestedCount: 1,
        processedCount: 1,
        unauthorizedSessionIds: [],
        missingSessionIds: [],
      },
    });
    getSessionOriginChainMock.mockResolvedValue({ ok: true, data: [{ providerId: 1 }] });
    getSessionResponseMock.mockResolvedValue({ ok: true, data: "ok" });
  });

  test("lists sessions and reads session details", async () => {
    const headers = { Authorization: "Bearer admin-token" };
    const active = await callV1Route({ method: "GET", pathname: "/api/v1/sessions", headers });
    expect(active.response.status).toBe(200);
    expect(active.json).toEqual({ items: [{ sessionId: "s1" }] });

    const all = await callV1Route({
      method: "GET",
      pathname: "/api/v1/sessions?state=all&activePage=2&inactivePage=3&pageSize=10",
      headers,
    });
    expect(all.response.status).toBe(200);
    expect(getAllSessionsMock).toHaveBeenCalledWith(2, 3, 10);

    const detail = await callV1Route({
      method: "GET",
      pathname: "/api/v1/sessions/s1?requestSequence=2",
      headers,
    });
    expect(detail.response.status).toBe(200);
    expect(getSessionDetailsMock).toHaveBeenCalledWith("s1", 2);
  });

  test("reads session payload subresources", async () => {
    const headers = { Authorization: "Bearer admin-token" };
    const messages = await callV1Route({
      method: "GET",
      pathname: "/api/v1/sessions/s1/messages?requestSequence=2",
      headers,
    });
    expect(messages.response.status).toBe(200);
    expect(getSessionMessagesMock).toHaveBeenCalledWith("s1", 2);

    const exists = await callV1Route({
      method: "GET",
      pathname: "/api/v1/sessions/s1/messages/exists",
      headers,
    });
    expect(exists.json).toEqual({ exists: true });

    const requests = await callV1Route({
      method: "GET",
      pathname: "/api/v1/sessions/s1/requests?page=2&pageSize=5&order=desc",
      headers,
    });
    expect(requests.response.status).toBe(200);
    expect(getSessionRequestsMock).toHaveBeenCalledWith("s1", 2, 5, "desc");

    const origin = await callV1Route({
      method: "GET",
      pathname: "/api/v1/sessions/s1/origin-chain",
      headers,
    });
    expect(origin.response.status).toBe(200);

    const response = await callV1Route({
      method: "GET",
      pathname: "/api/v1/sessions/s1/response",
      headers,
    });
    expect(response.json).toEqual({ response: "ok" });
  });

  test("terminates sessions and returns problem+json for action failures", async () => {
    const headers = { Authorization: "Bearer admin-token" };
    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/sessions/s1",
      headers,
    });
    expect(deleted.response.status).toBe(204);
    expect(terminateActiveSessionMock).toHaveBeenCalledWith("s1");

    const batch = await callV1Route({
      method: "POST",
      pathname: "/api/v1/sessions:batchTerminate",
      headers,
      body: { sessionIds: ["s1"] },
    });
    expect(batch.response.status).toBe(200);
    expect(terminateActiveSessionsBatchMock).toHaveBeenCalledWith(["s1"]);

    getSessionDetailsMock.mockResolvedValueOnce({ ok: false, error: "Session 不存在" });
    const missing = await callV1Route({
      method: "GET",
      pathname: "/api/v1/sessions/missing",
      headers,
    });
    expect(missing.response.status).toBe(404);
    expect(missing.json).toMatchObject({ errorCode: "session.not_found" });
  });

  test("documents session REST paths", async () => {
    const { json } = await callV1Route({ method: "GET", pathname: "/api/v1/openapi.json" });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/sessions");
    expect(doc.paths).toHaveProperty("/api/v1/sessions:batchTerminate");
    expect(doc.paths).toHaveProperty("/api/v1/sessions/{sessionId}");
    expect(doc.paths).toHaveProperty("/api/v1/sessions/{sessionId}/messages");
    expect(doc.paths).toHaveProperty("/api/v1/sessions/{sessionId}/messages/exists");
    expect(doc.paths).toHaveProperty("/api/v1/sessions/{sessionId}/requests");
    expect(doc.paths).toHaveProperty("/api/v1/sessions/{sessionId}/origin-chain");
    expect(doc.paths).toHaveProperty("/api/v1/sessions/{sessionId}/response");
  });
});
