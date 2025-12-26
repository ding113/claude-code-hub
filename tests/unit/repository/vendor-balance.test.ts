import { beforeEach, describe, expect, test, vi } from "vitest";

let insertedCheckValues: unknown;
let selectedChecks: unknown[] = [];

vi.mock("@/drizzle/db", () => {
  const insertReturningMock = vi.fn(async () => selectedChecks);
  const insertValuesMock = vi.fn((values: unknown) => {
    insertedCheckValues = values;
    return { returning: insertReturningMock };
  });
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const selectLimitMock = vi.fn(async () => selectedChecks);
  const selectWhereMock = vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: selectLimitMock })) }));
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  return {
    db: {
      insert: insertMock,
      select: selectMock,
    },
  };
});

describe("vendor-balance repository", () => {
  beforeEach(() => {
    insertedCheckValues = undefined;
    selectedChecks = [];
  });

  test("createVendorBalanceCheck stores balanceUsd as string and parses on read", async () => {
    selectedChecks = [
      {
        id: 1,
        vendorKeyId: 10,
        vendorId: 1,
        endpointId: 2,
        checkedAt: new Date("2024-01-01T00:00:00.000Z"),
        durationMs: 120,
        statusCode: 200,
        isSuccess: true,
        balanceUsd: "9.99",
        rawResponse: { ok: true },
        errorMessage: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    ];

    const { createVendorBalanceCheck } = await import("@/repository/vendor-balance");

    const check = await createVendorBalanceCheck({
      vendorKeyId: 10,
      vendorId: 1,
      endpointId: 2,
      durationMs: 120,
      statusCode: 200,
      isSuccess: true,
      balanceUsd: 9.99,
      rawResponse: { ok: true },
    });

    expect(insertedCheckValues).toMatchObject({
      vendorKeyId: 10,
      balanceUsd: "9.99",
      isSuccess: true,
    });
    expect(check.balanceUsd).toBe(9.99);
  });

  test("findLatestVendorBalanceCheckByKeyId returns null when no row", async () => {
    selectedChecks = [];

    const { findLatestVendorBalanceCheckByKeyId } = await import("@/repository/vendor-balance");
    const result = await findLatestVendorBalanceCheckByKeyId(10);

    expect(result).toBeNull();
  });
});
