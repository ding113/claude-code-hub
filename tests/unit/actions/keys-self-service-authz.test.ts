/**
 * U02: key 写操作的 self-or-admin 鉴权矩阵
 *
 * REST 路由放开到 read 层后，action 层必须兜底拒绝只读会话
 * （canLoginWebUi=false 的 key 经 read 层 / legacy adapter 的 scoped 上下文
 * 可以拿到非空 session），否则只读 key 可 PATCH 自己的 canLoginWebUi 自提权。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const findKeyByIdMock = vi.fn();
const countActiveKeysByUserMock = vi.fn();
const findKeyListMock = vi.fn();
const deleteKeyMock = vi.fn();
const updateKeyMock = vi.fn();
vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: countActiveKeysByUserMock,
  createKey: vi.fn(async () => ({})),
  deleteKey: deleteKeyMock,
  findActiveKeyByUserIdAndName: vi.fn(async () => null),
  findKeyById: findKeyByIdMock,
  findKeyList: findKeyListMock,
  findKeysWithStatistics: vi.fn(async () => []),
  resetKeyCostResetAt: vi.fn(),
  updateKey: updateKeyMock,
}));

const findUserByIdMock = vi.fn();
vi.mock("@/repository/user", () => ({
  findUserById: findUserByIdMock,
}));

vi.mock("@/actions/users", () => ({
  syncUserProviderGroupFromKeys: vi.fn(async () => undefined),
}));

vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: vi.fn(),
}));

vi.mock("@/lib/utils/timezone-resolver", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
}));

const OWN_KEY = {
  id: 42,
  userId: 99,
  name: "own-key",
  isEnabled: true,
  providerGroup: "default",
  canLoginWebUi: false,
};

const readOnlySession = { user: { id: 99, role: "user" }, key: { canLoginWebUi: false } };
const webSession = { user: { id: 99, role: "user" }, key: { canLoginWebUi: true } };
const adminSession = { user: { id: 1, role: "admin" }, key: { canLoginWebUi: true } };

beforeEach(() => {
  vi.clearAllMocks();
  deleteKeyMock.mockResolvedValue(true);
  updateKeyMock.mockResolvedValue({});
  findKeyByIdMock.mockResolvedValue({ ...OWN_KEY });
  findUserByIdMock.mockResolvedValue({ id: 99, providerGroup: "default" });
  countActiveKeysByUserMock.mockResolvedValue(5);
  findKeyListMock.mockResolvedValue([
    { id: 42, providerGroup: "default" },
    { id: 43, providerGroup: "default" },
  ]);
});

describe("removeKey read-only session guard", () => {
  it("denies a read-only session deleting its own key", async () => {
    getSessionMock.mockResolvedValue(readOnlySession);

    const { removeKey } = await import("@/actions/keys");
    const result = await removeKey(42);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PERMISSION_DENIED");
    }
    expect(deleteKeyMock).not.toHaveBeenCalled();
  });

  it("allows a Web-UI session deleting its own key", async () => {
    getSessionMock.mockResolvedValue(webSession);

    const { removeKey } = await import("@/actions/keys");
    const result = await removeKey(42);

    expect(result.ok).toBe(true);
    expect(deleteKeyMock).toHaveBeenCalledWith(42);
  });
});

describe("editKey self-service authorization", () => {
  it("denies a read-only session editing its own key (canLoginWebUi escalation)", async () => {
    getSessionMock.mockResolvedValue(readOnlySession);

    const { editKey } = await import("@/actions/keys");
    const result = await editKey(42, { name: "own-key", canLoginWebUi: true });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PERMISSION_DENIED");
    }
    expect(updateKeyMock).not.toHaveBeenCalled();
  });

  it("allows a Web-UI session editing its own key", async () => {
    getSessionMock.mockResolvedValue(webSession);

    const { editKey } = await import("@/actions/keys");
    const result = await editKey(42, { name: "renamed-key" });

    expect(result.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalled();
  });

  it("denies a Web-UI session editing someone else's key", async () => {
    getSessionMock.mockResolvedValue(webSession);
    findKeyByIdMock.mockResolvedValue({ ...OWN_KEY, userId: 7 });

    const { editKey } = await import("@/actions/keys");
    const result = await editKey(42, { name: "renamed-key" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PERMISSION_DENIED");
    }
    expect(updateKeyMock).not.toHaveBeenCalled();
  });

  it("blocks a non-admin from disabling the last enabled key through PATCH isEnabled", async () => {
    getSessionMock.mockResolvedValue(webSession);
    countActiveKeysByUserMock.mockResolvedValue(1);

    const { editKey } = await import("@/actions/keys");
    const result = await editKey(42, { name: "own-key", isEnabled: false });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("CANNOT_DISABLE_LAST_KEY");
    }
    expect(updateKeyMock).not.toHaveBeenCalled();
  });

  it("still allows an admin to disable the last enabled key through PATCH isEnabled", async () => {
    getSessionMock.mockResolvedValue(adminSession);
    countActiveKeysByUserMock.mockResolvedValue(1);

    const { editKey } = await import("@/actions/keys");
    const result = await editKey(42, { name: "own-key", isEnabled: false });

    expect(result.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalled();
  });
});

describe("toggleKeyEnabled self-service authorization", () => {
  it("denies a read-only session toggling its own key", async () => {
    getSessionMock.mockResolvedValue(readOnlySession);

    const { toggleKeyEnabled } = await import("@/actions/keys");
    const result = await toggleKeyEnabled(42, false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PERMISSION_DENIED");
    }
    expect(updateKeyMock).not.toHaveBeenCalled();
  });

  it("allows a Web-UI session toggling its own key", async () => {
    getSessionMock.mockResolvedValue(webSession);

    const { toggleKeyEnabled } = await import("@/actions/keys");
    const result = await toggleKeyEnabled(42, false);

    expect(result.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledWith(42, { is_enabled: false });
  });
});

describe("renewKeyExpiresAt self-service authorization", () => {
  it("denies a read-only session renewing its own key", async () => {
    getSessionMock.mockResolvedValue(readOnlySession);

    const { renewKeyExpiresAt } = await import("@/actions/keys");
    const result = await renewKeyExpiresAt(42, { expiresAt: "2027-01-01" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PERMISSION_DENIED");
    }
    expect(updateKeyMock).not.toHaveBeenCalled();
  });

  it("allows a Web-UI session renewing its own key", async () => {
    getSessionMock.mockResolvedValue(webSession);

    const { renewKeyExpiresAt } = await import("@/actions/keys");
    const result = await renewKeyExpiresAt(42, { expiresAt: "2027-01-01" });

    expect(result.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalled();
  });
});
