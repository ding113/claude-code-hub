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
vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: countActiveKeysByUserMock,
  createKey: vi.fn(async () => ({})),
  deleteKey: deleteKeyMock,
  findActiveKeyByUserIdAndName: vi.fn(async () => null),
  findKeyById: findKeyByIdMock,
  findKeyList: findKeyListMock,
  findKeysWithStatistics: vi.fn(async () => []),
  resetKeyCostResetAt: vi.fn(),
  updateKey: vi.fn(async () => ({})),
}));

const findUserByIdMock = vi.fn();
vi.mock("@/repository/user", () => ({
  findUserById: findUserByIdMock,
}));

vi.mock("@/actions/users", () => ({
  syncUserProviderGroupFromKeys: vi.fn(async () => undefined),
}));

const emitActionAuditMock = vi.fn();
vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: emitActionAuditMock,
}));

describe("removeKey action error codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteKeyMock.mockResolvedValue(true);
  });

  it("returns UNAUTHORIZED when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);

    const { removeKey } = await import("@/actions/keys");
    const result = await removeKey(42);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("UNAUTHORIZED");
      expect(result.error).toBe("UNAUTHORIZED");
    }
  });

  it("returns NOT_FOUND when the key does not exist", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findKeyByIdMock.mockResolvedValueOnce(null);

    const { removeKey } = await import("@/actions/keys");
    const result = await removeKey(42);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("NOT_FOUND");
      expect(result.error).toBe("KEY_NOT_FOUND");
    }
  });

  it("returns PERMISSION_DENIED when a non-admin deletes someone else's key", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 7, role: "user" } });
    findKeyByIdMock.mockResolvedValueOnce({
      id: 42,
      userId: 99,
      name: "other-key",
      isEnabled: true,
      providerGroup: "default",
    });

    const { removeKey } = await import("@/actions/keys");
    const result = await removeKey(42);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PERMISSION_DENIED");
      expect(result.error).toBe("PERMISSION_DENIED");
    }
  });

  it("returns CANNOT_DELETE_LAST_KEY when deleting the last enabled key", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findKeyByIdMock.mockResolvedValueOnce({
      id: 42,
      userId: 99,
      name: "last-key",
      isEnabled: true,
      providerGroup: "default",
    });
    countActiveKeysByUserMock.mockResolvedValueOnce(1);

    const { removeKey } = await import("@/actions/keys");
    const result = await removeKey(42);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("CANNOT_DELETE_LAST_KEY");
      expect(result.error).toBe("CANNOT_DELETE_LAST_KEY");
    }
    expect(deleteKeyMock).not.toHaveBeenCalled();
  });

  it("returns CANNOT_DELETE_LAST_GROUP_KEY when deleting would leave no provider group", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 99, role: "user" } });
    findKeyByIdMock.mockResolvedValueOnce({
      id: 42,
      userId: 99,
      name: "grouped-key",
      isEnabled: true,
      providerGroup: "default",
    });
    countActiveKeysByUserMock.mockResolvedValueOnce(2);
    findKeyListMock.mockResolvedValueOnce([{ id: 42, providerGroup: "default" }]);
    findUserByIdMock.mockResolvedValueOnce({ id: 99, providerGroup: "default" });

    const { removeKey } = await import("@/actions/keys");
    const result = await removeKey(42);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("CANNOT_DELETE_LAST_GROUP_KEY");
      expect(result.error).toBe("CANNOT_DELETE_LAST_GROUP_KEY");
    }
    expect(deleteKeyMock).not.toHaveBeenCalled();
  });

  it("returns DELETE_FAILED when the repository throws", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findKeyByIdMock.mockResolvedValueOnce({
      id: 42,
      userId: 99,
      name: "boom-key",
      isEnabled: false,
      providerGroup: "default",
    });
    deleteKeyMock.mockRejectedValueOnce(new Error("db exploded"));

    const { removeKey } = await import("@/actions/keys");
    const result = await removeKey(42);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("DELETE_FAILED");
      expect(result.error).toBe("db exploded");
    }
  });

  it("still deletes a disabled key successfully", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findKeyByIdMock.mockResolvedValueOnce({
      id: 42,
      userId: 99,
      name: "disabled-key",
      isEnabled: false,
      providerGroup: "default",
    });

    const { removeKey } = await import("@/actions/keys");
    const result = await removeKey(42);

    expect(result).toEqual({ ok: true });
    expect(deleteKeyMock).toHaveBeenCalledWith(42);
    expect(emitActionAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "key.delete", success: true })
    );
  });
});
