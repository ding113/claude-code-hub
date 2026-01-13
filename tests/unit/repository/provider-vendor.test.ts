import { describe, expect, test, vi } from "vitest";

function makeQuery(result: unknown) {
  const promise = Promise.resolve(result) as any;

  const chain = () => promise;

  promise.from = chain;
  promise.where = chain;
  promise.limit = chain;
  promise.orderBy = chain;
  promise.groupBy = chain;
  promise.set = chain;
  promise.values = chain;
  promise.returning = chain;
  promise.onConflictDoNothing = chain;

  return promise;
}

describe("provider-vendor repository - merge/split", () => {
  test("mergeProviderVendors: moves providers and dedupes endpoints", async () => {
    vi.resetModules();

    const selectResults: unknown[] = [
      [{ id: 10 }],
      [{ id: 2 }, { id: 3 }],
      [
        { id: 100, vendorId: 2, providerType: "claude", baseUrl: "https://a.example" },
        { id: 101, vendorId: 2, providerType: "claude", baseUrl: "https://b.example" },
        { id: 102, vendorId: 3, providerType: "claude", baseUrl: "https://a.example" },
      ],
      [{ id: 200, providerType: "claude", baseUrl: "https://a.example" }],
    ];

    const updateResults: unknown[] = [
      [{ id: 11 }, { id: 12 }, { id: 13 }],
      [{ id: 1 }, { id: 2 }],
      [],
      [],
      [{ id: 3 }],
      [],
      [{ id: 2 }, { id: 3 }],
    ];

    const tx = {
      select: vi.fn(() => makeQuery(selectResults.shift() ?? [])),
      update: vi.fn(() => makeQuery(updateResults.shift() ?? [])),
      insert: vi.fn(() => makeQuery([])),
    };

    vi.doMock("@/drizzle/db", () => ({
      db: {
        transaction: async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
      },
    }));

    vi.doMock("@/lib/logger", () => ({
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
    }));

    const { mergeProviderVendors } = await import("@/repository/provider-vendor");

    const result = await mergeProviderVendors({
      targetVendorId: 10,
      sourceVendorIds: [2, 3, 10],
    });

    expect(result.targetVendorId).toBe(10);
    expect(result.sourceVendorIds).toEqual([2, 3]);
    expect(result.movedProviders).toBe(3);
    expect(result.movedEndpoints).toBe(1);
    expect(result.dedupedEndpoints).toBe(2);
    expect(result.reattachedProbeEvents).toBe(3);
    expect(result.deletedVendors).toBe(2);
  });

  test("splitProviderVendor: creates vendor, moves providers, ensures endpoints", async () => {
    vi.resetModules();

    const selectResults: unknown[] = [[{ id: 1 }]];

    const insertResults: unknown[] = [
      [
        {
          id: 50,
          vendorKey: "new.example",
          displayName: "New Vendor",
          websiteUrl: null,
          faviconUrl: null,
          isEnabled: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          deletedAt: null,
        },
      ],
      [],
      [],
    ];

    const updateResults: unknown[] = [
      [
        { id: 1001, url: "https://p1.example", providerType: "claude" },
        { id: 1002, url: "https://p2.example", providerType: "codex" },
      ],
    ];

    const tx = {
      select: vi.fn(() => makeQuery(selectResults.shift() ?? [])),
      update: vi.fn(() => makeQuery(updateResults.shift() ?? [])),
      insert: vi.fn(() => makeQuery(insertResults.shift() ?? [])),
    };

    vi.doMock("@/drizzle/db", () => ({
      db: {
        transaction: async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
      },
    }));

    vi.doMock("@/lib/logger", () => ({
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
    }));

    const { splitProviderVendor } = await import("@/repository/provider-vendor");

    const result = await splitProviderVendor({
      sourceVendorId: 1,
      newVendorKey: "new.example",
      newDisplayName: "New Vendor",
      providerIdsToMove: [1001, 1002],
      websiteUrl: null,
      faviconUrl: null,
    });

    expect(result.sourceVendorId).toBe(1);
    expect(result.newVendor.id).toBe(50);
    expect(result.newVendor.vendorKey).toBe("new.example");
    expect(result.movedProviderIds).toEqual([1001, 1002]);
    expect(result.ensuredEndpoints).toBe(2);
  });
});
