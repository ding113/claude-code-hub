import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/drizzle/schema", () => ({
  quotaBoostGrants: {
    id: "id",
    userId: "userId",
    modelGroupId: "modelGroupId",
    window: "window",
    amountUsd: "amountUsd",
    validFrom: "validFrom",
    validTo: "validTo",
    note: "note",
    createdBy: "createdBy",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

const mockDeleteFn = vi.fn();
const mockInsertFn = vi.fn();
const mockFindMany = vi.fn();

vi.mock("@/drizzle/db", () => ({
  db: {
    get insert() {
      return mockInsertFn;
    },
    get delete() {
      return mockDeleteFn;
    },
    query: {
      quotaBoostGrants: {
        get findMany() {
          return mockFindMany;
        },
      },
    },
  },
}));

import {
  createQuotaBoostGrant,
  deleteExpiredQuotaBoostGrants,
  deleteQuotaBoostGrant,
  listActiveAndFutureGrantsByUser,
  listQuotaBoostGrants,
} from "@/repository/quota-boost";

const baseRow = {
  id: 1,
  userId: 42,
  modelGroupId: 7,
  window: "daily" as const,
  amountUsd: "10.00",
  validFrom: new Date("2026-01-01"),
  validTo: new Date("2026-12-31"),
  note: null,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("createQuotaBoostGrant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a row and returns it", async () => {
    const returningMock = vi.fn().mockResolvedValue([baseRow]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsertFn.mockReturnValue({ values: valuesMock });

    const result = await createQuotaBoostGrant({
      userId: 42,
      modelGroupId: 7,
      window: "daily",
      amountUsd: 10,
      validFrom: new Date("2026-01-01"),
      validTo: new Date("2026-12-31"),
    });

    expect(mockInsertFn).toHaveBeenCalledOnce();
    expect(result).toEqual(baseRow);
  });

  it("passes note and createdBy when provided", async () => {
    const returningMock = vi.fn().mockResolvedValue([baseRow]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsertFn.mockReturnValue({ values: valuesMock });

    await createQuotaBoostGrant({
      userId: 42,
      modelGroupId: 7,
      window: "5h",
      amountUsd: 5,
      validFrom: new Date(),
      validTo: new Date(),
      note: "test note",
      createdBy: 1,
    });

    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.note).toBe("test note");
    expect(insertedValues.createdBy).toBe(1);
  });

  it("defaults note and createdBy to null when omitted", async () => {
    const returningMock = vi.fn().mockResolvedValue([baseRow]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsertFn.mockReturnValue({ values: valuesMock });

    await createQuotaBoostGrant({
      userId: 42,
      modelGroupId: 7,
      window: "monthly",
      amountUsd: 100,
      validFrom: new Date(),
      validTo: new Date(),
    });

    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.note).toBeNull();
    expect(insertedValues.createdBy).toBeNull();
  });

  it("converts amountUsd number to string", async () => {
    const returningMock = vi.fn().mockResolvedValue([baseRow]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsertFn.mockReturnValue({ values: valuesMock });

    await createQuotaBoostGrant({
      userId: 1,
      modelGroupId: 1,
      window: "total",
      amountUsd: 99.99,
      validFrom: new Date(),
      validTo: new Date(),
    });

    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.amountUsd).toBe("99.99");
  });
});

describe("deleteQuotaBoostGrant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes by id and resolves void", async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    mockDeleteFn.mockReturnValue({ where: whereMock });

    await expect(deleteQuotaBoostGrant(1)).resolves.toBeUndefined();
    expect(mockDeleteFn).toHaveBeenCalledOnce();
    expect(whereMock).toHaveBeenCalledOnce();
  });
});

describe("listQuotaBoostGrants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all grants when no filter provided", async () => {
    mockFindMany.mockResolvedValue([baseRow]);

    const result = await listQuotaBoostGrants({});
    expect(result).toEqual([baseRow]);
    expect(mockFindMany).toHaveBeenCalledOnce();
  });

  it("filters by userId", async () => {
    mockFindMany.mockResolvedValue([baseRow]);

    await listQuotaBoostGrants({ userId: 42 });
    const opts = mockFindMany.mock.calls[0][0];
    expect(opts.where).toBeDefined();
  });

  it("filters by modelGroupId", async () => {
    mockFindMany.mockResolvedValue([baseRow]);

    await listQuotaBoostGrants({ modelGroupId: 7 });
    const opts = mockFindMany.mock.calls[0][0];
    expect(opts.where).toBeDefined();
  });

  it("applies both userId and modelGroupId filter", async () => {
    mockFindMany.mockResolvedValue([baseRow]);

    await listQuotaBoostGrants({ userId: 42, modelGroupId: 7 });
    const opts = mockFindMany.mock.calls[0][0];
    expect(opts.where).toBeDefined();
  });

  it("returns empty array when no results", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await listQuotaBoostGrants({ userId: 999 });
    expect(result).toEqual([]);
  });
});

describe("listActiveAndFutureGrantsByUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries grants with validTo > now for the given userId", async () => {
    mockFindMany.mockResolvedValue([baseRow]);

    const result = await listActiveAndFutureGrantsByUser(42);
    expect(result).toEqual([baseRow]);

    const opts = mockFindMany.mock.calls[0][0];
    expect(opts.where).toBeDefined();
    expect(opts.orderBy).toBeDefined();
  });

  it("returns empty when no active grants", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await listActiveAndFutureGrantsByUser(99);
    expect(result).toEqual([]);
  });
});

describe("deleteExpiredQuotaBoostGrants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns count of deleted rows", async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockDeleteFn.mockReturnValue({ where: whereMock });

    const count = await deleteExpiredQuotaBoostGrants();
    expect(count).toBe(2);
  });

  it("returns 0 when nothing is expired", async () => {
    const returningMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockDeleteFn.mockReturnValue({ where: whereMock });

    const count = await deleteExpiredQuotaBoostGrants();
    expect(count).toBe(0);
  });

  it("accepts an explicit cutoff date", async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 5 }]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockDeleteFn.mockReturnValue({ where: whereMock });

    const count = await deleteExpiredQuotaBoostGrants(new Date("2025-01-01"));
    expect(count).toBe(1);
  });
});
