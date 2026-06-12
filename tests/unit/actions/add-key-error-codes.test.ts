import { beforeEach, describe, expect, it, vi } from "vitest";

// U04: addKey business-validation failures (duplicate name, limit-exceeds-user)
// must carry a machine-readable errorCode (+ errorParams) so the self-service
// REST route (/users:self/keys) surfaces the specific reason instead of a
// generic OPERATION_FAILED toast. Translations are asserted as the identity
// key here (getTranslations mock returns the key verbatim).

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

const findActiveKeyByUserIdAndNameMock = vi.fn(async () => null as unknown);
const findKeyListMock = vi.fn(async () => [] as unknown[]);
vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: vi.fn(async () => 0),
  createKey: vi.fn(async () => ({ id: 1 })),
  findActiveKeyByUserIdAndName: findActiveKeyByUserIdAndNameMock,
  findKeyById: vi.fn(),
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

vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: vi.fn(),
}));

const baseUser = {
  id: 7,
  name: "self-user",
  role: "user" as const,
  providerGroup: "default",
  limit5hUsd: null,
  dailyQuota: null,
  limitWeeklyUsd: null,
  limitMonthlyUsd: null,
  limitTotalUsd: null,
  limitConcurrentSessions: null,
};

function selfKeyInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: 7,
    name: "work",
    providerGroup: "default",
    ...overrides,
  };
}

describe("addKey action error codes (self-service surfaceable)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Non-admin user creating a key for themselves; owns a default-group key so
    // the providerGroup subset check passes and we reach the business checks.
    getSessionMock.mockResolvedValue({ user: { id: 7, role: "user" } });
    findUserByIdMock.mockResolvedValue(baseUser);
    findKeyListMock.mockResolvedValue([{ providerGroup: "default" }]);
    findActiveKeyByUserIdAndNameMock.mockResolvedValue(null);
  });

  it("returns DUPLICATE_NAME errorCode + name param on a duplicate active key name", async () => {
    findActiveKeyByUserIdAndNameMock.mockResolvedValue({ id: 99, name: "work" });

    const { addKey } = await import("@/actions/keys");
    const result = await addKey(selfKeyInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("DUPLICATE_NAME");
      expect(result.errorParams).toMatchObject({ name: "work" });
    }
  });

  it("returns KEY_LIMIT_5H_EXCEEDS_USER_LIMIT errorCode + params when the key 5h limit exceeds the user cap", async () => {
    findUserByIdMock.mockResolvedValue({ ...baseUser, limit5hUsd: 10 });

    const { addKey } = await import("@/actions/keys");
    const result = await addKey(selfKeyInput({ limit5hUsd: 20 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("KEY_LIMIT_5H_EXCEEDS_USER_LIMIT");
      expect(result.errorParams).toMatchObject({ keyLimit: "20", userLimit: "10" });
    }
  });

  it("returns KEY_LIMIT_TOTAL_EXCEEDS_USER_LIMIT errorCode + params when the total limit exceeds the user cap", async () => {
    findUserByIdMock.mockResolvedValue({ ...baseUser, limitTotalUsd: 100 });

    const { addKey } = await import("@/actions/keys");
    const result = await addKey(selfKeyInput({ limitTotalUsd: 500 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("KEY_LIMIT_TOTAL_EXCEEDS_USER_LIMIT");
      expect(result.errorParams).toMatchObject({ keyLimit: "500", userLimit: "100" });
    }
  });
});
