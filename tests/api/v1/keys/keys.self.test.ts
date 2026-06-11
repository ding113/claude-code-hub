import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const addKeyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/actions/keys", () => ({
  addKey: addKeyMock,
}));

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const userSession = {
  user: { id: 2, role: "user", isEnabled: true },
  key: { id: 2, userId: 2, key: "user-token", canLoginWebUi: true },
} as AuthSession;

// Read-tier auth admits canLoginWebUi=false keys as read-only sessions; the
// self key-creation endpoint must reject them (issue #1259 / privilege fence).
const readOnlySession = {
  user: { id: 3, role: "user", isEnabled: true },
  key: { id: 3, userId: 3, key: "readonly-token", canLoginWebUi: false },
} as AuthSession;

describe("POST /api/v1/users:self/keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addKeyMock.mockResolvedValue({
      ok: true,
      data: { id: 77, generatedKey: "sk-new", name: "self-key" },
    });
  });

  test("creates a key for the session user without admin access", async () => {
    validateAuthTokenMock.mockResolvedValue(userSession);

    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users:self/keys",
      headers: { Authorization: "Bearer user-token" },
      body: { name: "self-key", providerGroup: "default" },
    });

    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("Location")).toBe("/api/v1/keys/77");
    expect(created.response.headers.get("Cache-Control")).toContain("no-store");
    expect(addKeyMock).toHaveBeenCalledWith({
      userId: 2,
      name: "self-key",
      providerGroup: "default",
    });
  });

  test("derives the target user from the session for admins too", async () => {
    validateAuthTokenMock.mockResolvedValue(adminSession);

    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users:self/keys",
      headers: { Authorization: "Bearer admin-token" },
      body: { name: "self-key" },
    });

    expect(created.response.status).toBe(201);
    expect(addKeyMock).toHaveBeenCalledWith({ userId: 1, name: "self-key" });
  });

  test("rejects body attempts to choose another user id via the strict schema", async () => {
    validateAuthTokenMock.mockResolvedValue(userSession);

    const response = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users:self/keys",
      headers: { Authorization: "Bearer user-token" },
      body: { name: "self-key", userId: 999 },
    });

    expect(response.response.status).toBe(400);
    expect(response.json).toMatchObject({ errorCode: "request.validation_failed" });
    expect(addKeyMock).not.toHaveBeenCalled();
  });

  test("rejects read-only sessions that cannot log into the Web UI", async () => {
    validateAuthTokenMock.mockResolvedValue(readOnlySession);

    const response = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users:self/keys",
      headers: { Authorization: "Bearer readonly-token" },
      body: { name: "escalation-attempt" },
    });

    expect(response.response.status).toBe(403);
    expect(response.json).toMatchObject({ errorCode: "auth.forbidden" });
    expect(addKeyMock).not.toHaveBeenCalled();
  });

  test("requires authentication", async () => {
    const response = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users:self/keys",
      body: { name: "anonymous" },
    });

    expect(response.response.status).toBe(401);
    expect(response.json).toMatchObject({ errorCode: "auth.missing" });
    expect(addKeyMock).not.toHaveBeenCalled();
  });

  test("surfaces action failures through the problem envelope", async () => {
    validateAuthTokenMock.mockResolvedValue(userSession);
    addKeyMock.mockResolvedValue({
      ok: false,
      error: "duplicate name",
      errorCode: "DUPLICATE_NAME",
    });

    const response = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users:self/keys",
      headers: { Authorization: "Bearer user-token" },
      body: { name: "self-key" },
    });

    expect(response.response.status).toBe(400);
    expect(response.json).toMatchObject({ errorCode: "DUPLICATE_NAME" });
  });

  test("keeps the per-user admin route admin-only", async () => {
    validateAuthTokenMock.mockResolvedValue(userSession);

    const response = await callV1Route({
      method: "POST",
      pathname: "/api/v1/users/2/keys",
      headers: { Authorization: "Bearer user-token" },
      body: { name: "self-key" },
    });

    expect(response.response.status).toBe(403);
    expect(response.json).toMatchObject({ errorCode: "auth.forbidden" });
    expect(addKeyMock).not.toHaveBeenCalled();
  });
});
