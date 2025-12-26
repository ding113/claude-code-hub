import { beforeEach, describe, expect, test, vi } from "vitest";

let insertedSyncValues: unknown;
let selectedSyncRows: unknown[] = [];

vi.mock("@/drizzle/db", () => {
  const insertReturningMock = vi.fn(async () => selectedSyncRows);
  const insertValuesMock = vi.fn((values: unknown) => {
    insertedSyncValues = values;
    return { onConflictDoUpdate: onConflictMock };
  });
  const onConflictMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const selectLimitMock = vi.fn(async () => selectedSyncRows);
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

describe("remote-config repository", () => {
  beforeEach(() => {
    insertedSyncValues = undefined;
    selectedSyncRows = [];
  });

  test("findRemoteConfigSyncByKey returns null when no row", async () => {
    selectedSyncRows = [];

    const { findRemoteConfigSyncByKey } = await import("@/repository/remote-config");
    const result = await findRemoteConfigSyncByKey("vendors");

    expect(result).toBeNull();
  });

  test("upsertRemoteConfigSync writes remoteVersion and returns parsed record", async () => {
    selectedSyncRows = [
      {
        id: 1,
        configKey: "vendors",
        remoteVersion: "2025.12.25",
        lastAttemptAt: null,
        lastSyncedAt: null,
        lastErrorMessage: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    ];

    const { upsertRemoteConfigSync } = await import("@/repository/remote-config");
    const record = await upsertRemoteConfigSync({
      configKey: "vendors",
      remoteVersion: "2025.12.25",
    });

    expect(insertedSyncValues).toMatchObject({
      configKey: "vendors",
      remoteVersion: "2025.12.25",
    });
    expect(record.configKey).toBe("vendors");
  });
});
