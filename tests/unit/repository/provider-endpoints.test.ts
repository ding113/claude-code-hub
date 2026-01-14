import { describe, expect, test, vi } from "vitest";

function createThenableQuery<T>(result: T) {
  type Query = Promise<T> & {
    from: (...args: unknown[]) => Query;
    where: (...args: unknown[]) => Query;
    orderBy: (...args: unknown[]) => Query;
    limit: (...args: unknown[]) => Query;
  };

  const query = Promise.resolve(result) as unknown as Query;
  query.from = () => query;
  query.where = () => query;
  query.orderBy = () => query;
  query.limit = () => query;
  return query;
}

describe("provider-endpoints repository", () => {
  test("ensureProviderEndpointExistsForUrl: url 为空时返回 false 且不写 DB", async () => {
    vi.resetModules();

    const insertMock = vi.fn();
    vi.doMock("@/drizzle/db", () => ({
      db: {
        insert: insertMock,
      },
    }));

    const { ensureProviderEndpointExistsForUrl } = await import("@/repository/provider-endpoints");
    const ok = await ensureProviderEndpointExistsForUrl({
      vendorId: 1,
      providerType: "claude",
      url: "   ",
    });

    expect(ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  test("ensureProviderEndpointExistsForUrl: url 非法时返回 false 且不写 DB", async () => {
    vi.resetModules();

    const insertMock = vi.fn();
    vi.doMock("@/drizzle/db", () => ({
      db: {
        insert: insertMock,
      },
    }));

    const { ensureProviderEndpointExistsForUrl } = await import("@/repository/provider-endpoints");
    const ok = await ensureProviderEndpointExistsForUrl({
      vendorId: 1,
      providerType: "claude",
      url: "not a url",
    });

    expect(ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  test("ensureProviderEndpointExistsForUrl: 插入成功时返回 true（trim + label=null）", async () => {
    vi.resetModules();

    const state = { values: undefined as unknown };
    const returning = vi.fn(async () => [{ id: 1 }]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn((payload: unknown) => {
      state.values = payload;
      return { onConflictDoNothing };
    });
    const insertMock = vi.fn(() => ({ values }));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        insert: insertMock,
      },
    }));

    const { ensureProviderEndpointExistsForUrl } = await import("@/repository/provider-endpoints");
    const ok = await ensureProviderEndpointExistsForUrl({
      vendorId: 1,
      providerType: "claude",
      url: " https://api.example.com ",
    });

    expect(ok).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);

    expect(state.values).toEqual(
      expect.objectContaining({
        vendorId: 1,
        providerType: "claude",
        url: "https://api.example.com",
        label: null,
      })
    );
  });

  test("ensureProviderEndpointExistsForUrl: 冲突不插入时返回 false", async () => {
    vi.resetModules();

    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insertMock = vi.fn(() => ({ values }));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        insert: insertMock,
      },
    }));

    const { ensureProviderEndpointExistsForUrl } = await import("@/repository/provider-endpoints");
    const ok = await ensureProviderEndpointExistsForUrl({
      vendorId: 1,
      providerType: "claude",
      url: "https://api.example.com",
    });

    expect(ok).toBe(false);
  });

  test("backfillProviderEndpointsFromProviders: 全部无效时不写 DB", async () => {
    vi.resetModules();

    const selectPages = [
      [
        { id: 1, vendorId: 0, providerType: "claude", url: "https://ok.example.com" },
        { id: 2, vendorId: 1, providerType: "claude", url: "   " },
        { id: 3, vendorId: 1, providerType: "claude", url: "not a url" },
      ],
      [],
    ];

    const selectMock = vi.fn(() => createThenableQuery(selectPages.shift() ?? []));
    const insertMock = vi.fn();

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        insert: insertMock,
      },
    }));

    const { backfillProviderEndpointsFromProviders } = await import(
      "@/repository/provider-endpoints"
    );
    const result = await backfillProviderEndpointsFromProviders();

    expect(result).toEqual({ inserted: 0, uniqueCandidates: 0, skippedInvalid: 3 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  test("backfillProviderEndpointsFromProviders: 去重 + trim + 统计 inserted/uniqueCandidates/skippedInvalid", async () => {
    vi.resetModules();

    const capturedValues: unknown[] = [];

    const insertState = { values: undefined as unknown };
    const returning = vi.fn(async () => {
      const values = insertState.values;
      if (!Array.isArray(values)) return [];
      return values.map((_, idx) => ({ id: idx + 1 }));
    });
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn((payload: unknown) => {
      insertState.values = payload;
      if (Array.isArray(payload)) capturedValues.push(...payload);
      return { onConflictDoNothing };
    });
    const insertMock = vi.fn(() => ({ values }));

    const selectPages = [
      [
        { id: 1, vendorId: 1, providerType: "claude", url: " https://a.com " },
        { id: 2, vendorId: 1, providerType: "claude", url: "https://a.com" },
        { id: 3, vendorId: 1, providerType: "openai-compatible", url: "https://a.com" },
      ],
      [
        { id: 4, vendorId: 2, providerType: "claude", url: "https://a.com" },
        { id: 5, vendorId: 0, providerType: "claude", url: "https://bad-vendor.com" },
        { id: 6, vendorId: 1, providerType: "claude", url: "not a url" },
      ],
      [],
    ];

    const selectMock = vi.fn(() => createThenableQuery(selectPages.shift() ?? []));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        insert: insertMock,
      },
    }));

    const { backfillProviderEndpointsFromProviders } = await import(
      "@/repository/provider-endpoints"
    );
    const result = await backfillProviderEndpointsFromProviders();

    expect(result).toEqual({ inserted: 3, uniqueCandidates: 3, skippedInvalid: 2 });

    expect(capturedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ vendorId: 1, providerType: "claude", url: "https://a.com" }),
        expect.objectContaining({
          vendorId: 1,
          providerType: "openai-compatible",
          url: "https://a.com",
        }),
        expect.objectContaining({ vendorId: 2, providerType: "claude", url: "https://a.com" }),
      ])
    );
  });

  test("backfillProviderEndpointsFromProviders: 冲突不插入时 inserted=0 但 uniqueCandidates 仍统计", async () => {
    vi.resetModules();

    const insertState = { values: undefined as unknown };
    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn((payload: unknown) => {
      insertState.values = payload;
      return { onConflictDoNothing };
    });
    const insertMock = vi.fn(() => ({ values }));

    const selectPages = [
      [
        { id: 1, vendorId: 1, providerType: "claude", url: "https://a.com" },
        { id: 2, vendorId: 1, providerType: "openai-compatible", url: "https://a.com" },
      ],
      [],
    ];

    const selectMock = vi.fn(() => createThenableQuery(selectPages.shift() ?? []));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        insert: insertMock,
      },
    }));

    const { backfillProviderEndpointsFromProviders } = await import(
      "@/repository/provider-endpoints"
    );
    const result = await backfillProviderEndpointsFromProviders();

    expect(result).toEqual({ inserted: 0, uniqueCandidates: 2, skippedInvalid: 0 });
  });
});
