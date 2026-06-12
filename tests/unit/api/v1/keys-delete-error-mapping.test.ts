import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const removeKeyMock = vi.fn();
vi.mock("@/actions/keys", () => ({
  removeKey: removeKeyMock,
}));

vi.mock("@/lib/api/v1/_shared/action-bridge", () => ({
  callAction: vi.fn(async (_c: unknown, action: (...args: unknown[]) => unknown, args: unknown[]) =>
    action(...(args ?? []))
  ),
}));

function makeContext(keyId = "12"): Context {
  return {
    req: {
      param: (name: string) => (name === "keyId" ? keyId : undefined),
      url: `http://localhost/api/v1/keys/${keyId}`,
    },
    get: (name: string) =>
      name === "auth"
        ? { session: { user: { id: 1, role: "admin" }, key: { canLoginWebUi: true } } }
        : undefined,
  } as unknown as Context;
}

async function runDelete(result: unknown): Promise<Response> {
  removeKeyMock.mockResolvedValueOnce(result);
  const { deleteKey } = await import("@/app/api/v1/resources/keys/handlers");
  return deleteKey(makeContext());
}

describe("DELETE /api/v1/keys/{keyId} error mapping", () => {
  beforeEach(() => {
    removeKeyMock.mockReset();
  });

  it("returns 204 on success", async () => {
    const response = await runDelete({ ok: true });
    expect(response.status).toBe(204);
  });

  it("maps NOT_FOUND to 404 and keeps the action error code", async () => {
    const response = await runDelete({
      ok: false,
      error: "key missing",
      errorCode: "NOT_FOUND",
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ errorCode: "NOT_FOUND" });
  });

  it("maps KEY_NOT_FOUND to 404 and keeps the action error code", async () => {
    const response = await runDelete({
      ok: false,
      error: "key missing",
      errorCode: "KEY_NOT_FOUND",
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ errorCode: "KEY_NOT_FOUND" });
  });

  it("maps PERMISSION_DENIED to 403 and keeps the action error code", async () => {
    const response = await runDelete({
      ok: false,
      error: "denied",
      errorCode: "PERMISSION_DENIED",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ errorCode: "PERMISSION_DENIED" });
  });

  it("maps UNAUTHORIZED to 403 and keeps the action error code", async () => {
    const response = await runDelete({
      ok: false,
      error: "no session",
      errorCode: "UNAUTHORIZED",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ errorCode: "UNAUTHORIZED" });
  });

  it("keeps CANNOT_DELETE_LAST_KEY visible to the client instead of key.action_failed", async () => {
    const response = await runDelete({
      ok: false,
      error: "last key",
      errorCode: "CANNOT_DELETE_LAST_KEY",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "CANNOT_DELETE_LAST_KEY" });
  });

  it("keeps CANNOT_DELETE_LAST_GROUP_KEY visible to the client", async () => {
    const response = await runDelete({
      ok: false,
      error: "last group key",
      errorCode: "CANNOT_DELETE_LAST_GROUP_KEY",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "CANNOT_DELETE_LAST_GROUP_KEY" });
  });

  it("keeps DELETE_FAILED visible to the client", async () => {
    const response = await runDelete({
      ok: false,
      error: "boom",
      errorCode: "DELETE_FAILED",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "DELETE_FAILED" });
  });
});
