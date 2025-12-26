import { beforeEach, describe, expect, test, vi } from "vitest";

let insertedKeyValues: unknown;
let selectedKeys: unknown[] = [];

vi.mock("@/drizzle/db", () => {
  const insertReturningMock = vi.fn(async () => selectedKeys);
  const insertValuesMock = vi.fn((values: unknown) => {
    insertedKeyValues = values;
    return { returning: insertReturningMock };
  });
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const selectLimitMock = vi.fn(async () => selectedKeys);
  const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock }));
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  return {
    db: {
      insert: insertMock,
      select: selectMock,
    },
  };
});

describe("vendor-key repository", () => {
  beforeEach(() => {
    insertedKeyValues = undefined;
    selectedKeys = [];
  });

  test("createVendorKey converts numeric fields to string for storage and parses on read", async () => {
    const createdAt = new Date("2024-01-01T00:00:00.000Z");
    const updatedAt = new Date("2024-01-01T00:00:00.000Z");

    selectedKeys = [
      {
        id: 1,
        vendorId: 1,
        endpointId: 2,
        isUserOverride: false,
        balanceUsd: "100.500000",
        balanceUpdatedAt: null,
        name: "Key 1",
        description: null,
        url: "https://api.example.com",
        key: "sk-test",
        isEnabled: true,
        weight: 1,
        priority: 0,
        costMultiplier: "1.25",
        groupTag: null,
        providerType: "claude",
        preserveClientIp: false,
        modelRedirects: null,
        allowedModels: null,
        joinClaudePool: false,
        codexInstructionsStrategy: "auto",
        mcpPassthroughType: "none",
        mcpPassthroughUrl: null,
        limit5hUsd: "10.00",
        limitDailyUsd: null,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitConcurrentSessions: 0,
        maxRetryAttempts: null,
        circuitBreakerFailureThreshold: 5,
        circuitBreakerOpenDuration: 1800000,
        circuitBreakerHalfOpenSuccessThreshold: 2,
        proxyUrl: null,
        proxyFallbackToDirect: false,
        firstByteTimeoutStreamingMs: 0,
        streamingIdleTimeoutMs: 0,
        requestTimeoutNonStreamingMs: 0,
        websiteUrl: null,
        faviconUrl: null,
        cacheTtlPreference: null,
        context1mPreference: null,
        tpm: 0,
        rpm: 0,
        rpd: 0,
        cc: 0,
        createdAt,
        updatedAt,
        deletedAt: null,
      },
    ];

    const { createVendorKey } = await import("@/repository/vendor-key");

    const key = await createVendorKey({
      vendorId: 1,
      endpointId: 2,
      name: "Key 1",
      url: "https://api.example.com",
      key: "sk-test",
      costMultiplier: 1.25,
      limit5hUsd: 10,
    });

    expect(insertedKeyValues).toMatchObject({
      vendorId: 1,
      endpointId: 2,
      name: "Key 1",
      url: "https://api.example.com",
      key: "sk-test",
      costMultiplier: "1.25",
      limit5hUsd: "10",
    });
    expect(key.costMultiplier).toBe(1.25);
    expect(key.balanceUsd).toBe(100.5);
  });

  test("findVendorKeyById returns null when no row", async () => {
    selectedKeys = [];

    const { findVendorKeyById } = await import("@/repository/vendor-key");
    const result = await findVendorKeyById(123);

    expect(result).toBeNull();
  });
});
