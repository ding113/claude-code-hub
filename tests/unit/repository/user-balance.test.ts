import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    execute: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  return {
    tx,
    db: {
      transaction: vi.fn(async (callback: (tx: typeof tx) => unknown) => callback(tx)),
    },
    invalidateCachedUser: vi.fn(async () => {}),
    insertChain: {
      values: vi.fn(),
      onConflictDoNothing: vi.fn(),
      returning: vi.fn(),
    },
    updateChain: {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    },
    userBalanceCharges: {
      id: "user_balance_charges.id",
      requestId: "user_balance_charges.requestId",
      chargeKey: "user_balance_charges.chargeKey",
    },
    users: {
      id: "users.id",
      balanceUsd: "users.balanceUsd",
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));
vi.mock("@/drizzle/db", () => ({ db: mocks.db }));
vi.mock("@/drizzle/schema", () => ({
  userBalanceCharges: mocks.userBalanceCharges,
  users: mocks.users,
}));
vi.mock("@/lib/security/api-key-auth-cache", () => ({
  invalidateCachedUser: mocks.invalidateCachedUser,
}));

import { chargeUserBalance } from "@/repository/user-balance";

function resetChains() {
  mocks.insertChain.values.mockReturnValue(mocks.insertChain);
  mocks.insertChain.onConflictDoNothing.mockReturnValue(mocks.insertChain);
  mocks.updateChain.set.mockReturnValue(mocks.updateChain);
  mocks.updateChain.where.mockReturnValue(mocks.updateChain);
  mocks.tx.insert.mockReturnValue(mocks.insertChain);
  mocks.tx.update.mockReturnValue(mocks.updateChain);
}

describe("chargeUserBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
    mocks.tx.execute
      .mockResolvedValueOnce([{ balance_usd: "1.000000000000000" }])
      .mockResolvedValueOnce([]);
    mocks.insertChain.returning.mockResolvedValue([{ id: 1 }]);
    mocks.updateChain.returning.mockResolvedValue([{ balanceUsd: "0.500000000000000" }]);
  });

  it("invalidates the cached user only after a finite balance debit", async () => {
    await expect(
      chargeUserBalance({
        userId: 7,
        requestId: 8,
        providerId: 9,
        chargeKey: "winner",
        amountUsd: "0.5",
      })
    ).resolves.toEqual({ status: "charged", balanceUsd: "0.500000000000000" });

    expect(mocks.db.transaction).toHaveBeenCalledOnce();
    expect(mocks.invalidateCachedUser).toHaveBeenCalledOnce();
    expect(mocks.invalidateCachedUser).toHaveBeenCalledWith(7);
  });

  it("does not invalidate the cache for an idempotent replay", async () => {
    mocks.tx.execute.mockReset();
    mocks.tx.execute
      .mockResolvedValueOnce([{ balance_usd: "1.000000000000000" }])
      .mockResolvedValueOnce([{ id: 1 }]);

    await expect(
      chargeUserBalance({
        userId: 7,
        requestId: 8,
        providerId: 9,
        chargeKey: "winner",
        amountUsd: 0.5,
      })
    ).resolves.toEqual({ status: "already_charged" });

    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });
});
