import { describe, expect, it, vi } from "vitest";

process.env.DSN = "";

vi.mock("@/drizzle/db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
    execute: vi.fn(async () => []),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: vi.fn((...args: unknown[]) => args),
    eq: vi.fn((...args: unknown[]) => args),
    gte: vi.fn((...args: unknown[]) => args),
    lt: vi.fn((...args: unknown[]) => args),
    inArray: vi.fn((...args: unknown[]) => args),
  };
});

vi.mock("@/drizzle/schema", () => ({
  usageLedger: {
    userId: "user_id",
    key: "key",
    finalProviderId: "final_provider_id",
    costUsd: "cost_usd",
    createdAt: "created_at",
    blockedBy: "blocked_by",
  },
}));

vi.mock("@/repository/_shared/ledger-conditions", () => ({
  LEDGER_BILLING_CONDITION: {},
}));

const repo = await import("@/repository/usage-ledger");

describe("usage-ledger repository", () => {
  it("exports sumLedgerCostInTimeRange", () => {
    expect(typeof repo.sumLedgerCostInTimeRange).toBe("function");
  });

  it("exports sumLedgerTotalCost", () => {
    expect(typeof repo.sumLedgerTotalCost).toBe("function");
  });

  it("exports sumLedgerTotalCostBatch", () => {
    expect(typeof repo.sumLedgerTotalCostBatch).toBe("function");
  });

  it("exports countLedgerRequestsInTimeRange", () => {
    expect(typeof repo.countLedgerRequestsInTimeRange).toBe("function");
  });
});
