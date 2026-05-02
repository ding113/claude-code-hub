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
vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: vi.fn(async () => 1),
  createKey: vi.fn(async () => ({})),
  deleteKey: vi.fn(async () => true),
  findActiveKeyByUserIdAndName: vi.fn(async () => null),
  findKeyById: findKeyByIdMock,
  findKeyList: vi.fn(async () => []),
  findKeysWithStatistics: vi.fn(async () => []),
  resetKeyCostResetAt: vi.fn(),
  updateKey: vi.fn(async () => ({})),
}));

vi.mock("@/repository/user", () => ({
  findUserById: vi.fn(),
}));

vi.mock("@/actions/users", () => ({
  syncUserProviderGroupFromKeys: vi.fn(async () => undefined),
}));

const emitActionAuditMock = vi.fn();
vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: emitActionAuditMock,
}));

describe("getUnmaskedKey action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the unmasked key for an admin caller and writes a redacted audit event", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findKeyByIdMock.mockResolvedValueOnce({
      id: 42,
      name: "user-key",
      key: "sk-actual-secret-value",
      userId: 99,
    });

    const { getUnmaskedKey } = await import("@/actions/keys");
    const result = await getUnmaskedKey(42);

    expect(result).toEqual({ ok: true, data: { key: "sk-actual-secret-value" } });
    expect(emitActionAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "key",
        action: "key.key_reveal",
        targetType: "key",
        targetId: "42",
        targetName: "user-key",
        success: true,
        redactExtraKeys: ["key"],
      })
    );
    expect(JSON.stringify(emitActionAuditMock.mock.calls)).not.toContain("sk-actual-secret-value");
  });

  it("rejects non-admin callers", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 7, role: "user" } });

    const { getUnmaskedKey } = await import("@/actions/keys");
    const result = await getUnmaskedKey(42);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("权限");
    }
    expect(findKeyByIdMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    getSessionMock.mockResolvedValue(null);

    const { getUnmaskedKey } = await import("@/actions/keys");
    const result = await getUnmaskedKey(42);

    expect(result.ok).toBe(false);
  });

  it("returns 404 when the key cannot be found", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findKeyByIdMock.mockResolvedValueOnce(null);

    const { getUnmaskedKey } = await import("@/actions/keys");
    const result = await getUnmaskedKey(404);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("不存在");
    }
  });
});
