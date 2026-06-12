/**
 * U02: key 写 handler 的会话级守卫
 *
 * PATCH/DELETE /keys/{id}、:enable、:renew 从 admin 层放开到 read 层后，
 * handler 必须拒绝只读会话（read 层接纳 canLoginWebUi=false 的 key 会话），
 * 完整 Web 会话与管理员放行到 action 层做 self-or-admin 所有权检查。
 */

import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const removeKeyMock = vi.fn();
const editKeyMock = vi.fn();
const toggleKeyEnabledMock = vi.fn();
const renewKeyExpiresAtMock = vi.fn();
vi.mock("@/actions/keys", () => ({
  removeKey: removeKeyMock,
  editKey: editKeyMock,
  toggleKeyEnabled: toggleKeyEnabledMock,
  renewKeyExpiresAt: renewKeyExpiresAtMock,
}));

vi.mock("@/lib/api/v1/_shared/action-bridge", () => ({
  callAction: vi.fn(async (_c: unknown, action: (...args: unknown[]) => unknown, args: unknown[]) =>
    action(...(args ?? []))
  ),
}));

type AuthValue = {
  session: {
    user: { id: number; role: string };
    key: { canLoginWebUi: boolean };
  } | null;
} | null;

function makeContext(auth: AuthValue, body?: unknown, keyId = "12"): Context {
  return {
    req: {
      param: (name: string) => (name === "keyId" ? keyId : undefined),
      url: `http://localhost/api/v1/keys/${keyId}`,
      header: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/json" : undefined,
      json: async () => body,
      raw: { headers: new Headers({ "content-type": "application/json" }) },
    },
    get: (name: string) => (name === "auth" ? auth : undefined),
  } as unknown as Context;
}

const readOnlyAuth: AuthValue = {
  session: { user: { id: 9, role: "user" }, key: { canLoginWebUi: false } },
};
const webAuth: AuthValue = {
  session: { user: { id: 9, role: "user" }, key: { canLoginWebUi: true } },
};
const adminAuth: AuthValue = {
  session: { user: { id: 1, role: "admin" }, key: { canLoginWebUi: true } },
};

beforeEach(() => {
  vi.clearAllMocks();
  removeKeyMock.mockResolvedValue({ ok: true });
  editKeyMock.mockResolvedValue({ ok: true });
  toggleKeyEnabledMock.mockResolvedValue({ ok: true });
  renewKeyExpiresAtMock.mockResolvedValue({ ok: true });
});

describe("key write handlers reject read-only sessions (U02)", () => {
  it("deleteKey: read-only session gets 403 and the action is not called", async () => {
    const { deleteKey } = await import("@/app/api/v1/resources/keys/handlers");
    const response = await deleteKey(makeContext(readOnlyAuth));
    expect(response.status).toBe(403);
    expect(removeKeyMock).not.toHaveBeenCalled();
  });

  it("deleteKey: missing session gets 401", async () => {
    const { deleteKey } = await import("@/app/api/v1/resources/keys/handlers");
    const response = await deleteKey(makeContext(null));
    expect(response.status).toBe(401);
    expect(removeKeyMock).not.toHaveBeenCalled();
  });

  it("deleteKey: Web-UI session passes through to the action", async () => {
    const { deleteKey } = await import("@/app/api/v1/resources/keys/handlers");
    const response = await deleteKey(makeContext(webAuth));
    expect(response.status).toBe(204);
    expect(removeKeyMock).toHaveBeenCalledWith(12);
  });

  it("updateKey: read-only session gets 403 and the action is not called", async () => {
    const { updateKey } = await import("@/app/api/v1/resources/keys/handlers");
    const response = await updateKey(makeContext(readOnlyAuth, { name: "renamed" }));
    expect(response.status).toBe(403);
    expect(editKeyMock).not.toHaveBeenCalled();
  });

  it("updateKey: admin session passes through to the action", async () => {
    const { updateKey } = await import("@/app/api/v1/resources/keys/handlers");
    const response = await updateKey(makeContext(adminAuth, { name: "renamed" }));
    expect(response.status).toBe(200);
    expect(editKeyMock).toHaveBeenCalled();
  });

  it("enableKey: read-only session gets 403 and the action is not called", async () => {
    const { enableKey } = await import("@/app/api/v1/resources/keys/handlers");
    const response = await enableKey(makeContext(readOnlyAuth, { enabled: false }));
    expect(response.status).toBe(403);
    expect(toggleKeyEnabledMock).not.toHaveBeenCalled();
  });

  it("enableKey: Web-UI session passes through to the action", async () => {
    const { enableKey } = await import("@/app/api/v1/resources/keys/handlers");
    const response = await enableKey(makeContext(webAuth, { enabled: false }));
    expect(response.status).toBe(200);
    expect(toggleKeyEnabledMock).toHaveBeenCalledWith(12, false);
  });

  it("renewKey: read-only session gets 403 and the action is not called", async () => {
    const { renewKey } = await import("@/app/api/v1/resources/keys/handlers");
    const response = await renewKey(makeContext(readOnlyAuth, { expiresAt: "2027-01-01" }));
    expect(response.status).toBe(403);
    expect(renewKeyExpiresAtMock).not.toHaveBeenCalled();
  });

  it("renewKey: Web-UI session passes through to the action", async () => {
    const { renewKey } = await import("@/app/api/v1/resources/keys/handlers");
    const response = await renewKey(makeContext(webAuth, { expiresAt: "2027-01-01" }));
    expect(response.status).toBe(200);
    expect(renewKeyExpiresAtMock).toHaveBeenCalled();
  });
});
