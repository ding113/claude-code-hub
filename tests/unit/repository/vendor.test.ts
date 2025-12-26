import { beforeEach, describe, expect, test, vi } from "vitest";

let insertedVendorValues: unknown;
let selectedVendors: unknown[] = [];
let updateReturningRows: Array<{ id: number }> = [];

vi.mock("@/drizzle/db", () => {
  const insertReturningMock = vi.fn(async () => selectedVendors);
  const insertValuesMock = vi.fn((values: unknown) => {
    insertedVendorValues = values;
    return { returning: insertReturningMock };
  });
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const selectLimitMock = vi.fn(async () => selectedVendors);
  const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock }));
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const updateReturningMock = vi.fn(async () => updateReturningRows);
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    db: {
      insert: insertMock,
      select: selectMock,
      update: updateMock,
    },
  };
});

describe("vendor repository", () => {
  beforeEach(() => {
    insertedVendorValues = undefined;
    selectedVendors = [];
    updateReturningRows = [];
  });

  test("createVendor converts numeric fields to string for storage and parses on read", async () => {
    const createdAt = new Date("2024-01-01T00:00:00.000Z");
    const updatedAt = new Date("2024-01-01T00:00:00.000Z");

    selectedVendors = [
      {
        id: 1,
        slug: "openai",
        name: "OpenAI",
        description: null,
        category: "official",
        isManaged: false,
        isEnabled: true,
        tags: ["codex"],
        websiteUrl: null,
        faviconUrl: null,
        balanceCheckEnabled: true,
        balanceCheckEndpoint: "/v1/usage",
        balanceCheckJsonpath: "$.remaining",
        balanceCheckIntervalSeconds: 600,
        balanceCheckLowThresholdUsd: "12.34",
        createdAt,
        updatedAt,
        deletedAt: null,
      },
    ];

    const { createVendor } = await import("@/repository/vendor");

    const vendor = await createVendor({
      slug: "openai",
      name: "OpenAI",
      category: "official",
      tags: ["codex"],
      balanceCheckEnabled: true,
      balanceCheckEndpoint: "/v1/usage",
      balanceCheckJsonpath: "$.remaining",
      balanceCheckIntervalSeconds: 600,
      balanceCheckLowThresholdUsd: 12.34,
    });

    expect(insertedVendorValues).toMatchObject({
      slug: "openai",
      name: "OpenAI",
      category: "official",
      tags: ["codex"],
      balanceCheckLowThresholdUsd: "12.34",
    });

    expect(vendor.balanceCheckLowThresholdUsd).toBe(12.34);
    expect(vendor.createdAt).toBeInstanceOf(Date);
    expect(vendor.updatedAt).toBeInstanceOf(Date);
  });

  test("findVendorBySlug returns null when no row", async () => {
    selectedVendors = [];

    const { findVendorBySlug } = await import("@/repository/vendor");
    const result = await findVendorBySlug("missing");

    expect(result).toBeNull();
  });

  test("deleteVendor returns true when a row is marked deleted", async () => {
    updateReturningRows = [{ id: 123 }];

    const { deleteVendor } = await import("@/repository/vendor");
    const ok = await deleteVendor(123);

    expect(ok).toBe(true);
  });
});
