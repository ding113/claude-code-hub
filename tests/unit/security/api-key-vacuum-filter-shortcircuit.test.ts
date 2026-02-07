import { describe, expect, test, vi } from "vitest";

const isDefinitelyNotPresent = vi.fn(() => true);

vi.mock("@/lib/security/api-key-vacuum-filter", () => ({
  apiKeyVacuumFilter: {
    isDefinitelyNotPresent,
    noteExistingKey: vi.fn(),
    startBackgroundReload: vi.fn(),
    getStats: vi.fn(),
  },
}));

// 如果 Vacuum Filter 没有短路成功，这些 DB 调用会触发并让测试失败
vi.mock("@/drizzle/db", () => ({
  db: {
    select: vi.fn(() => {
      throw new Error("DB_ACCESS");
    }),
    insert: vi.fn(() => {
      throw new Error("DB_ACCESS");
    }),
    update: vi.fn(() => {
      throw new Error("DB_ACCESS");
    }),
  },
}));

describe("API Key Vacuum Filter：负向短路（避免打 DB）", () => {
  test("validateApiKeyAndGetUser：definitely not present 时应直接返回 null", async () => {
    const { validateApiKeyAndGetUser } = await import("@/repository/key");
    await expect(validateApiKeyAndGetUser("invalid_key")).resolves.toBeNull();
    expect(isDefinitelyNotPresent).toHaveBeenCalledWith("invalid_key");
  });

  test("findActiveKeyByKeyString：definitely not present 时应直接返回 null", async () => {
    const { findActiveKeyByKeyString } = await import("@/repository/key");
    await expect(findActiveKeyByKeyString("invalid_key")).resolves.toBeNull();
    expect(isDefinitelyNotPresent).toHaveBeenCalledWith("invalid_key");
  });
});

